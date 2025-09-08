 

import { setGlobalOptions } from "firebase-functions";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import dotenv from "dotenv";
import crypto from "node:crypto";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import { GoogleGenAI, createUserContent, type Part } from "@google/genai";
import type { Request, Response } from "express";

dotenv.config();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

initializeApp();
const db = getFirestore();
try { (db as any).settings?.({ ignoreUndefinedProperties: true }); } catch {}
const bucket = getStorage().bucket();

const DEFAULT_IMAGE_MODEL = (process.env.GEMINI_IMAGE_MODEL ?? "").trim() || "gemini-2.5-flash-image-preview";

function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in functions/.env");
  }
  return new GoogleGenAI({ apiKey });
}
type Era = "1890" | "1920" | "1940" | "1970" | "1980" | "1990" | "2000" | "2010" | "2090";
type Variant = "mild" | "balanced" | "cinematic";

interface SceneDoc {
  ownerUid: string;
  title?: string;
  status?: "draft" | "ready" | "publishing" | "published";
  original?: { gsUri?: string; width?: number; height?: number; sha256?: string } | null;
  masks?: Array<{ id: string; label: "person" | "vehicle" | "pet" | "manual"; gsUri: string; areaPx?: number }>; // unused in mask-free flow
  eras?: Era[];
  outputs?: Record<Era, Array<{ variant: Variant; gsUri: string; width?: number; height?: number; sha256?: string; meta?: any }>>;
  public?: { isPublic?: boolean; publicId?: string | null; createdAt?: FirebaseFirestore.Timestamp };
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
}
function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpsError("invalid-argument", `${name} must be a non-empty string`);
  }
}

function assertAuth<T extends { auth?: { uid?: string | null } | null }>(req: T): string {
  const uid = req?.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required");
  return uid;
}

function gsPathFromUri(gsUri?: string | null): string | null {
  if (!gsUri) return null;
  if (!gsUri.startsWith("gs://")) return gsUri;
  const [, , ...rest] = gsUri.split("/");
  const path = rest.slice(1).join("/");
  return path || null;
}

function joinPath(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

async function fileExists(path: string): Promise<boolean> {
  const [exists] = await bucket.file(path).exists();
  return !!exists;
}

function dailyLimitFromAuth(auth: any | undefined): number {
  const provider = auth?.token?.firebase?.sign_in_provider;
  return provider === "anonymous" ? 10 : 25;
}

const DAILY_TZ = "America/Los_Angeles";
function toSFDateString(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAILY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const da = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${da}`;
}

async function readDailyQuota(uid: string, dailyLimit: number): Promise<{ dailyRequests: number; dailyLimit: number }>{
  const userRef = db.collection("users").doc(uid);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = (snap.data() || {}) as any;
    const dailyDate = (data.dailyDate as string) || toSFDateString(new Date(now));
    let dailyRequests = Number.isFinite(data.dailyRequests) ? Number(data.dailyRequests) : 0;

    const today = toSFDateString(new Date(now));
    if (today !== dailyDate) {
      dailyRequests = 0;
    }

    tx.set(
      userRef,
      {
        dailyRequests,
        dailyDate: today,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  const fresh = await userRef.get();
  const out = (fresh.data() || {}) as any;
  return {
    dailyRequests: Number(out.dailyRequests || 0),
    dailyLimit,
  };
}

async function chargeQuota(uid: string, cost: number, dailyLimit: number): Promise<void> {
  if (cost <= 0) return;
  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = (snap.data() || {}) as any;
    const now = Date.now();
    const today = toSFDateString(new Date(now));
    const dailyDate = (data.dailyDate as string) || today;
    let dailyRequests = Number.isFinite(data.dailyRequests) ? Number(data.dailyRequests) : 0;
    if (today !== dailyDate) dailyRequests = 0;
    if (dailyRequests + cost > dailyLimit) {
      throw new HttpsError("resource-exhausted", "Daily limit reached");
    }

    dailyRequests += cost;
    tx.set(
      userRef,
      {
        dailyRequests,
        dailyDate: today,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

async function getSceneChecked(sceneId: string, uid: string): Promise<{ ref: FirebaseFirestore.DocumentReference; data: SceneDoc }>{
  const ref = db.collection("scenes").doc(sceneId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Scene not found");
  const data = snap.data() as SceneDoc;
  if (!data?.ownerUid || data.ownerUid !== uid) {
    throw new HttpsError("permission-denied", "You do not own this scene");
  }
  return { ref, data };
}

async function saveRender(
  sceneId: string,
  era: Era,
  variant: Variant,
  imageBuffer: Buffer,
  contentType: "image/jpeg" | "image/png" = "image/jpeg",
  previewMaxWidth = 1600
): Promise<{ gsUri: string; width: number; height: number; sha256: string; previewGsUri: string }>{
  const hash = crypto.createHash("sha256").update(imageBuffer).digest("hex");

  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  const basePath = joinPath("scenes", sceneId, "renders", era, variant);
  const mainPath = `${basePath}.jpg`;
  const previewPath = `${basePath}.preview.jpg`;

  const mainToken = crypto.randomUUID();
  await bucket.file(mainPath).save(imageBuffer, {
    contentType,
    public: false,
    resumable: false,
    validation: false,
    metadata: { metadata: { firebaseStorageDownloadTokens: mainToken } },
  });

  const preview = await sharp(imageBuffer).resize({ width: previewMaxWidth, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const previewToken = crypto.randomUUID();
  await bucket.file(previewPath).save(preview, {
    contentType: "image/jpeg",
    public: false,
    resumable: false,
    validation: false,
    metadata: { metadata: { firebaseStorageDownloadTokens: previewToken } },
  });

  return {
    gsUri: `gs://${bucket.name}/${mainPath}`,
    previewGsUri: `gs://${bucket.name}/${previewPath}`,
    width,
    height,
    sha256: hash,
  };
}

async function gsInlinePart(gsUri: string): Promise<Part> {
  const path = gsPathFromUri(gsUri);
  if (!path) throw new HttpsError("invalid-argument", "Invalid gs:// URI");
  const file = bucket.file(path);
  const [buffer] = await file.download();
  let mime = "image/jpeg";
  try { const [meta] = await file.getMetadata(); mime = (meta?.contentType as string) || mime; } catch {}
  return { inlineData: { data: buffer.toString("base64"), mimeType: mime } } as Part;
}

function buildEraPrompt(era: Era, variant: Variant, negatives?: string, style?: string): string {
  const intensity = variant === "mild" ? "20–30%" : variant === "balanced" ? "40–60%" : "70–90%";
  const lines: string[] = [];
  lines.push("Using the provided street photo, transform the scene to be historically accurate for the requested era while matching the original camera, perspective, and lighting.");
  lines.push(`Overall intensity: ${variant} (${intensity} change), keeping the photo's identity intact.`);
  lines.push("Preserve completely: building geometry, curb lines, vanishing points, window spacing, camera viewpoint, and shadow direction. Do not change the time of day or weather.");
  lines.push("Keep core composition and identities recognizable; avoid heavy changes to faces unless needed for era styling.");
  switch (era) {
    case "1890":
      lines.push("Era 1890: gas or early electric lamps; horse-drawn traffic; cast-iron facades; serif signage painted on wood; subdued sepia tone; remove modern vehicles and electronic displays.");
      break;
    case "1920":
      lines.push("Era 1920: signage with serif lettering; early concrete and brick textures; reduced palette; lower saturation; subtle film grain; remove modern cars; no LED panels; add overhead cables sparingly; match sun direction.");
      break;
    case "1940":
      lines.push("Era 1940: mid-century storefronts; enamel signs; rounded vehicle silhouettes; muted primary colors; wartime-era materials where appropriate; no digital displays.");
      break;
    case "1970":
      lines.push("Era 1970: saturated storefronts; period typography; boxy cars; sodium-vapor tint at night; storefront awnings; vinyl banners.");
      break;
    case "1980":
      lines.push("Era 1980: neon accents; tube signage; chrome and bold geometric shapes; boxy cars; slight halation around lights; CRT-style screens only indoors.");
      break;
    case "1990":
      lines.push("Era 1990: early backlit billboards; compact cars; VHS/early DV vibe optional; no smartphones; low-contrast graphics; remove LED walls.");
      break;
    case "2000":
      lines.push("Era 2000: glossy billboards; early smartphones sparse; modern sedans; minimal LED panels; restrained color grading.");
      break;
    case "2010":
      lines.push("Era 2010: LED billboards; glass facades; contemporary vehicles; saturated advertising; clean materials.");
      break;
    case "2090":
      lines.push("Era 2090: composite/self-healing materials with soft patina; subtle display surfaces; transit infrastructure; e-micromobility lanes; holographic signage; preserve street width/perspective.");
      break;
  }
  lines.push("Constraints: avoid warping buildings or perspective; do not invent new people; avoid text overlays or watermarks; keep grain/texture consistent with the source.");
  if (negatives && negatives.trim().length) {
    lines.push(`Semantic negatives: ${negatives.trim()}`);
  }
  if (style && style.trim().length) {
    lines.push(`Style preset: ${style.trim()}`);
  }
  lines.push("Steps: (1) Analyze the photo's lighting and materials. (2) Replace era-specific elements (signage, vehicles, materials) according to the target era. (3) Verify edges are clean and consistent with the photo's depth of field. (4) Ensure all preserved regions remain pixel-consistent.");
  lines.push("Output: a single edited image at the same resolution as the input.");
  return lines.join("\n");
}
export const getQuota = onCall(async (req) => {
  const uid = assertAuth(req);
  const q = await readDailyQuota(uid, dailyLimitFromAuth(req.auth));
  return q;
});

export const renderEra = onCall(async (req) => {
  const uid = assertAuth(req);
  const { sceneId, era, variant, idempotencyKey } = req.data || {};
  const reroll = req?.data?.reroll === true;
  assertString(sceneId, "sceneId");
  assertString(era, "era");
  assertString(variant, "variant");

  const eraVal = String(era) as Era;
  const variantVal = String(variant) as Variant;
  if (!(["1890","1920","1940","1970","1980","1990","2000","2010","2090"] as Era[]).includes(eraVal)) {
    throw new HttpsError("invalid-argument", "Invalid era");
  }
  if (!(["mild", "balanced", "cinematic"] as Variant[]).includes(variantVal)) {
    throw new HttpsError("invalid-argument", "Invalid variant");
  }

  const { ref, data } = await getSceneChecked(sceneId, uid);

  const outPath = joinPath("scenes", sceneId, "renders", eraVal, `${variantVal}.jpg`);
  if (!reroll && await fileExists(outPath)) {
    const gsUri = `gs://${bucket.name}/${outPath}`;
    const outputs = (data.outputs || {}) as SceneDoc["outputs"];
    const eraArr = outputs?.[eraVal] || [];
    const found = eraArr.find((o) => o.variant === variantVal);
    if (found) {
      return { ...found, cached: true };
    }
    return { gsUri, variant: variantVal, cached: true };
  }

  await chargeQuota(uid, 1, dailyLimitFromAuth(req.auth));

  if (!data?.original?.gsUri) {
    throw new HttpsError("failed-precondition", "Scene is missing original image");
  }
  const modelId = DEFAULT_IMAGE_MODEL;
  const ai = getGenAI();
  const negatives = typeof req.data?.negatives === 'string' ? String(req.data.negatives) : undefined;
  const style = typeof req.data?.style === 'string' ? String(req.data.style) : undefined;
  const prompt = buildEraPrompt(eraVal, variantVal, negatives, style);
  const inputParts: any[] = [
    prompt,
    await gsInlinePart(data.original.gsUri),
  ];
  const contents = createUserContent(inputParts);

  const response = await ai.models.generateContent({ model: modelId, contents });
  const cand = response.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const imagePart = parts.find((p: any) => p?.inlineData?.data);
  if (!imagePart) {
    const textPart = parts.find((p: any) => typeof (p as any)?.text === 'string');
    const msg = textPart ? (textPart as any).text : 'No image returned by model';
    throw new HttpsError("internal", `Generation failed: ${msg}`);
  }
  const inline = (imagePart as any).inlineData as { data: string; mimeType?: string };
  const outBuf = Buffer.from(inline.data, "base64");
  const rendered = await sharp(outBuf).jpeg({ quality: 96 }).toBuffer();
  const saved = await saveRender(sceneId, eraVal, variantVal, rendered, "image/jpeg");

  const outputs = (data.outputs ?? ({} as any)) as NonNullable<SceneDoc["outputs"]>;
  const arr = Array.isArray(outputs?.[eraVal]) ? outputs![eraVal] : [];
  const record = { variant: variantVal, gsUri: saved.gsUri, width: saved.width, height: saved.height, sha256: saved.sha256 } as const;
  const newOutputs = { ...(outputs || {}) } as Record<string, any>;
  newOutputs[eraVal] = [
    ...arr.filter((x) => x.variant !== variantVal),
    { ...record },
  ];
  await ref.set({ outputs: newOutputs, updatedAt: FieldValue.serverTimestamp() } as Partial<SceneDoc>, { merge: true });

  logger.info("renderEra completed (gemini)", { sceneId, era: eraVal, variant: variantVal, idempotencyKey, modelId });
  return record;
});

export const publishScene = onCall(async (req) => {
  const uid = assertAuth(req);
  const { sceneId } = req.data || {};
  assertString(sceneId, "sceneId");

  const { ref, data } = await getSceneChecked(sceneId, uid);

  const outputs = (data.outputs ?? ({} as any)) as NonNullable<SceneDoc["outputs"]>;
  const eras = (data.eras && data.eras.length ? data.eras : (["1890","1920","1940","1970","1980","1990","2000","2010","2090"] as Era[]));
  let coverRef: string | null = null;
  for (const e of eras) {
    const arr = outputs[e];
    if (arr && arr.length) {
      const bal = arr.find((x) => x.variant === "balanced");
      coverRef = (bal || arr[0]).gsUri;
      break;
    }
  }
  if (!coverRef) coverRef = data?.original?.gsUri || null;
  if (!coverRef) throw new HttpsError("failed-precondition", "No image available to publish");

  const srcPath = gsPathFromUri(coverRef)!;
  const [srcBuf] = await bucket.file(srcPath).download();
  const sizes = [1280, 720, 360];
  await Promise.all(
    sizes.map(async (w) => {
      const buf = await sharp(srcBuf).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
      const thumbPath = joinPath("scenes", sceneId, "thumbs", `${w}.jpg`);
      const token = crypto.randomUUID();
      await bucket.file(thumbPath).save(buf, {
        contentType: "image/jpeg",
        public: false,
        resumable: false,
        validation: false,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
    })
  );

  const publicId = `p_${sceneId.slice(0, 6)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.collection("public").doc(publicId).set({
    sceneId,
    coverRef: coverRef,
    eraDefault: eras[0] || "1920",
    viewCount: 0,
    createdAt: FieldValue.serverTimestamp(),
  });

  await ref.set({ public: { isPublic: true, publicId, createdAt: FieldValue.serverTimestamp() }, status: "published", updatedAt: FieldValue.serverTimestamp() } as Partial<SceneDoc>, { merge: true });

  logger.info("publishScene completed", { sceneId, publicId });
  return { publicId };
});

export const health = onRequest((_req, res) => {
  res.json({ status: "ok" });
});

// --- Pretty URL serving & downloads ---
function assertAccess(scene: SceneDoc, uid?: string | null): void {
  const isOwner = !!uid && scene.ownerUid === uid;
  const isPublic = !!scene.public?.isPublic;
  if (!(isOwner || isPublic)) {
    throw new HttpsError("permission-denied", "You do not have access to this scene");
  }
}

async function outputPathFor(sceneId: string, era: Era, variant: Variant): Promise<string> {
  const path = joinPath("scenes", sceneId, "renders", era, `${variant}.jpg`);
  return (await fileExists(path)) ? path : path; // path is canonical
}

async function getSigned(path: string, filename: string, attachment: boolean): Promise<string> {
  const file = bucket.file(path);
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes
  const disposition = `${attachment ? 'attachment' : 'inline'}; filename="${filename}"`;
  const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires, responseDisposition: disposition });
  return url;
}

function parseEraVariant(req: Request): { sceneId: string; era: Era; variant: Variant }{
  const parts = req.path.split('/').filter(Boolean);
  // Expect: /api/(scene|download)/:sceneId/:era/:variant(.jpg)?
  const sceneId = parts[2];
  const era = (parts[3] || '') as Era;
  const variant = ((parts[4] || '').replace(/\.jpg$/i, '')) as Variant;
  if (!sceneId || !era || !variant) throw new HttpsError('invalid-argument', 'Invalid path');
  return { sceneId, era, variant };
}

export const serveRender = onRequest(async (req: Request, res: Response) => {
  try {
    const { sceneId, era, variant } = parseEraVariant(req);
    const uid = (req as any).auth?.uid || null; // will be undefined unless behind callable/identity proxy
    const ref = db.collection('scenes').doc(sceneId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Scene not found');
    const scene = snap.data() as SceneDoc;
    assertAccess(scene, uid);
    const p = await outputPathFor(sceneId, era, variant);
    const url = await getSigned(p, `${sceneId}-${era}-${variant}.jpg`, false);
    res.set('Cache-Control', 'private, max-age=60');
    res.set('X-Robots-Tag', 'noimageindex');
    res.redirect(302, url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    res.status(400).json({ error: msg });
  }
});

export const downloadRender = onRequest(async (req: Request, res: Response) => {
  try {
    const { sceneId, era, variant } = parseEraVariant(req);
    const ref = db.collection('scenes').doc(sceneId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Scene not found');
    const scene = snap.data() as SceneDoc;
    // Only owner or published scenes can be downloaded
    assertAccess(scene, (req as any).auth?.uid || null);
    const p = await outputPathFor(sceneId, era, variant);
    const filename = (req.query?.filename as string) || `chronolens-${sceneId}-${era}-${variant}.jpg`;
    const url = await getSigned(p, filename, true);
    res.set('Cache-Control', 'private, max-age=60');
    res.set('X-Robots-Tag', 'noimageindex');
    res.redirect(302, url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    res.status(400).json({ error: msg });
  }
});
