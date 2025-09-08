/**
 * ChronoLens Cloud Functions
 *
 * Implements callable API endpoints used by the client:
 * - analyzeScene(sceneId)
 * - renderEra(sceneId, era, variant, idempotencyKey)
 * - publishScene(sceneId)
 * - getQuota()
 *
 * Notes:
 * - Image generation/editing calls to Gemini are stubbed for now. Rendering
 *   writes a re-encoded copy of the original as a placeholder output so the
 *   app flow and Storage/Firestore wiring can be validated end-to-end.
 */

import { setGlobalOptions } from "firebase-functions";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import dotenv from "dotenv";
import crypto from "node:crypto";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";
import {
  GoogleGenAI,
  createUserContent,
  type Part,
} from "@google/genai";

dotenv.config();

// Function defaults
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

// Admin SDK
initializeApp();
const db = getFirestore();
try { (db as any).settings?.({ ignoreUndefinedProperties: true }); } catch {}
const bucket = getStorage().bucket();

// Gemini
const DEFAULT_IMAGE_MODEL = (process.env.GEMINI_IMAGE_MODEL ?? "").trim() || "gemini-2.5-flash-image-preview";

function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in functions/.env");
  }
  return new GoogleGenAI({ apiKey });
}

// ---------- Types ----------
type Era = "1920" | "1970" | "2090";
type Variant = "mild" | "balanced" | "cinematic";

interface SceneDoc {
  ownerUid: string;
  title?: string;
  status?: "draft" | "ready" | "publishing" | "published";
  original?: { gsUri?: string; width?: number; height?: number; sha256?: string } | null;
  masks?: Array<{ id: string; label: "person" | "vehicle" | "pet" | "manual"; gsUri: string; areaPx?: number }>;
  eras?: Era[];
  outputs?: Record<Era, Array<{ variant: Variant; gsUri: string; width?: number; height?: number; sha256?: string; meta?: any }>>;
  public?: { isPublic?: boolean; publicId?: string | null; createdAt?: FirebaseFirestore.Timestamp };
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
}

// ---------- Small utils ----------
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
  if (!gsUri.startsWith("gs://")) return gsUri; // already a path
  const [, , ...rest] = gsUri.split("/");
  const path = rest.slice(1).join("/"); // drop bucket name
  return path || null;
}

function joinPath(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

async function fileExists(path: string): Promise<boolean> {
  const [exists] = await bucket.file(path).exists();
  return !!exists;
}

// (sha256Hex helper not currently needed)

// ---------- Quota (daily counter only) ----------
// Daily limit depends on auth type: anonymous=10/day, authenticated=25/day
function dailyLimitFromAuth(auth: any | undefined): number {
  const provider = auth?.token?.firebase?.sign_in_provider;
  return provider === "anonymous" ? 10 : 25;
}

const DAILY_TZ = "America/Los_Angeles"; // San Francisco time (handles DST)
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

    // Reset daily counter on date change (AEST)
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

// ---------- Core data helpers ----------
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

async function writeMasks(sceneRef: FirebaseFirestore.DocumentReference, masks: SceneDoc["masks"]): Promise<void> {
  await sceneRef.set({ masks: masks ?? [], updatedAt: FieldValue.serverTimestamp() } as Partial<SceneDoc>, { merge: true });
}

async function saveRender(
  sceneId: string,
  era: Era,
  variant: Variant,
  imageBuffer: Buffer,
  contentType: "image/jpeg" | "image/png" = "image/jpeg",
  previewMaxWidth = 1600
): Promise<{ gsUri: string; width: number; height: number; sha256: string; previewGsUri: string }>{
  // Compute sha256
  const hash = crypto.createHash("sha256").update(imageBuffer).digest("hex");

  // Get image dimensions
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  // Paths
  const basePath = joinPath("scenes", sceneId, "renders", era, variant);
  const mainPath = `${basePath}.jpg`;
  const previewPath = `${basePath}.preview.jpg`;

  // Write main with download token for client access
  const mainToken = crypto.randomUUID();
  await bucket.file(mainPath).save(imageBuffer, {
    contentType,
    public: false,
    resumable: false,
    validation: false,
    metadata: { metadata: { firebaseStorageDownloadTokens: mainToken } },
  });

  // Write preview (resize by width)
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

// ---------- Image + Prompt helpers ----------
async function gsInlinePart(gsUri: string): Promise<Part> {
  const path = gsPathFromUri(gsUri);
  if (!path) throw new HttpsError("invalid-argument", "Invalid gs:// URI");
  const file = bucket.file(path);
  const [buffer] = await file.download();
  let mime = "image/jpeg";
  try { const [meta] = await file.getMetadata(); mime = (meta?.contentType as string) || mime; } catch {}
  return { inlineData: { data: buffer.toString("base64"), mimeType: mime } } as Part;
}

function buildEraPrompt(era: Era, variant: Variant, hasMasks: boolean, negatives?: string): string {
  const intensity = variant === "mild" ? "20–30%" : variant === "balanced" ? "40–60%" : "70–90%";
  const lines: string[] = [];
  // Narrative first: describe desired scene according to best practices
  lines.push("Using the provided street photo, transform the scene to be historically accurate for the requested era while matching the original camera, perspective, and lighting.");
  lines.push(`Overall intensity: ${variant} (${intensity} change), keeping the photo's identity intact.`);
  lines.push("Preserve completely: building geometry, curb lines, vanishing points, window spacing, camera viewpoint, and shadow direction. Do not change the time of day or weather.");
  if (hasMasks) {
    lines.push("There is a companion black/white mask image: white = subjects to KEEP unchanged; black = regions that may be edited. Do not alter any white areas.");
  } else {
    lines.push("Important: Keep human subjects unchanged. Avoid altering people or pets.");
  }
  switch (era) {
    case "1920":
      lines.push("Era 1920: signage with serif lettering; early concrete and brick textures; reduced palette; lower saturation; subtle film grain; remove modern cars; no LED panels; add overhead cables sparingly; match sun direction.");
      break;
    case "1970":
      lines.push("Era 1970: saturated storefronts; period typography; boxy cars; sodium-vapor tint at night; storefront awnings; vinyl banners.");
      break;
    case "2090":
      lines.push("Era 2090: composite/self-healing materials with soft patina; subtle display surfaces; transit infrastructure; e-micromobility lanes; holographic signage; preserve street width/perspective.");
      break;
  }
  lines.push("Constraints: avoid warping buildings or perspective; do not invent new people; avoid text overlays or watermarks; keep grain/texture consistent with the source.");
  if (negatives && negatives.trim().length) {
    lines.push(`Semantic negatives: ${negatives.trim()}`);
  }
  // Simple step-by-step guidance
  lines.push("Steps: (1) Analyze the photo's lighting and materials. (2) Replace era-specific elements (signage, vehicles, materials) according to the target era. (3) Verify edges are clean and consistent with the photo's depth of field. (4) Ensure all preserved regions remain pixel-consistent.");
  lines.push("Output: a single edited image at the same resolution as the input.");
  return lines.join("\n");
}

async function buildUnionMaskPartIfAny(scene: SceneDoc): Promise<Part | null> {
  const masks = Array.isArray(scene.masks) ? scene.masks : [];
  if (masks.length === 0) return null;
  try {
    // Load first mask to get dimensions
    const firstPath = gsPathFromUri(masks[0].gsUri);
    if (!firstPath) return null;
    const [firstBuf] = await bucket.file(firstPath).download();
    const meta = await sharp(firstBuf).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (!width || !height) return null;

    // Prepare a union by repeatedly lightening over a black canvas
    const prepared: Buffer[] = [];
    for (const m of masks) {
      const p = gsPathFromUri(m.gsUri);
      if (!p) continue;
      const [buf] = await bucket.file(p).download();
      const bin = await sharp(buf).removeAlpha().greyscale().threshold(1).toColourspace('b-w').toBuffer();
      prepared.push(bin);
    }
    if (prepared.length === 0) return null;
    let pipeline = sharp(prepared[0]);
    for (let i = 1; i < prepared.length; i++) {
      pipeline = pipeline.composite([{ input: prepared[i], blend: 'lighten' }]);
    }
    const union = await pipeline.png().toBuffer();
    return { inlineData: { data: union.toString('base64'), mimeType: 'image/png' } } as Part;
  } catch {
    return null; // mask building is best-effort; don't fail generation on mask issues
  }
}

// ---------- Callable Endpoints ----------

export const getQuota = onCall(async (req) => {
  const uid = assertAuth(req);
  const q = await readDailyQuota(uid, dailyLimitFromAuth(req.auth));
  return q;
});

export const analyzeScene = onCall(async (req) => {
  const uid = assertAuth(req);
  const sceneId = (req.data?.sceneId as unknown);
  assertString(sceneId, "sceneId");

  const { ref, data } = await getSceneChecked(sceneId, uid);
  if (!data?.original?.gsUri) {
    throw new HttpsError("failed-precondition", "Scene is missing original image");
  }

  // Rate limit: 1 token
  await chargeQuota(uid, 1, dailyLimitFromAuth(req.auth));

  // STUB: In a future iteration, call Gemini to detect masks and write PNGs.
  // For now, we return an empty set and keep client mask editing functional.
  const masks: SceneDoc["masks"] = [];
  await writeMasks(ref, masks);

  await ref.set({ status: "ready", updatedAt: FieldValue.serverTimestamp() } as Partial<SceneDoc>, { merge: true });
  logger.info("analyzeScene completed", { sceneId });
  return { masks };
});

export const renderEra = onCall(async (req) => {
  const uid = assertAuth(req);
  const { sceneId, era, variant, idempotencyKey } = req.data || {};
  assertString(sceneId, "sceneId");
  assertString(era, "era");
  assertString(variant, "variant");

  const eraVal = String(era) as Era;
  const variantVal = String(variant) as Variant;
  if (!(["1920", "1970", "2090"] as Era[]).includes(eraVal)) {
    throw new HttpsError("invalid-argument", "Invalid era");
  }
  if (!(["mild", "balanced", "cinematic"] as Variant[]).includes(variantVal)) {
    throw new HttpsError("invalid-argument", "Invalid variant");
  }

  const { ref, data } = await getSceneChecked(sceneId, uid);

  // Idempotency: short-circuit if output already exists
  const outPath = joinPath("scenes", sceneId, "renders", eraVal, `${variantVal}.jpg`);
  if (await fileExists(outPath)) {
    const gsUri = `gs://${bucket.name}/${outPath}`;
    const outputs = (data.outputs || {}) as SceneDoc["outputs"];
    const eraArr = outputs?.[eraVal] || [];
    const found = eraArr.find((o) => o.variant === variantVal);
    if (found) {
      return { ...found, cached: true };
    }
    // If file exists but Firestore not updated, return a minimal reference
    return { gsUri, variant: variantVal, cached: true };
  }

  // Charge quota: 1 unit per render
  await chargeQuota(uid, 1, dailyLimitFromAuth(req.auth));

  // Compose Gemini request using original image and an era-specific prompt
  if (!data?.original?.gsUri) {
    throw new HttpsError("failed-precondition", "Scene is missing original image");
  }
  const modelId = DEFAULT_IMAGE_MODEL;
  const ai = getGenAI();
  const hasMasks = Array.isArray(data?.masks) && data!.masks!.length > 0;
  const negatives = typeof req.data?.negatives === 'string' ? String(req.data.negatives) : undefined;
  const prompt = buildEraPrompt(eraVal, variantVal, hasMasks, negatives);
  const inputParts: any[] = [
    prompt,
    await gsInlinePart(data.original.gsUri),
  ];
  const maskPart = await buildUnionMaskPartIfAny(data);
  if (maskPart) {
    inputParts.push("Reference mask: white = preserve, black = editable.");
    inputParts.push(maskPart);
  }
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

  // Update Firestore outputs
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

  // Pick a cover: prefer balanced of first era with output
  const outputs = (data.outputs ?? ({} as any)) as NonNullable<SceneDoc["outputs"]>;
  const eras = (data.eras && data.eras.length ? data.eras : (["1920", "1970", "2090"] as Era[]));
  let coverRef: string | null = null;
  for (const e of eras) {
    const arr = outputs[e];
    if (arr && arr.length) {
      const bal = arr.find((x) => x.variant === "balanced");
      coverRef = (bal || arr[0]).gsUri;
      break;
    }
  }
  if (!coverRef) {
    // fallback to original
    coverRef = data?.original?.gsUri || null;
  }
  if (!coverRef) throw new HttpsError("failed-precondition", "No image available to publish");

  // Create thumbnails into /scenes/{sceneId}/thumbs/
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

  // Public doc
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

// Simple health endpoint for smoke tests
export const health = onRequest((_req, res) => {
  res.json({ status: "ok" });
});
