import { DI } from '@aurelia/kernel';
import { addDoc, collection, doc, serverTimestamp, updateDoc, type FieldValue } from 'firebase/firestore';
import { getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { resolve } from 'aurelia';
import { IHttp } from './http-client';
import { auth, db } from '../core/firebase';

export type Era = '1890' | '1920' | '1940' | '1970' | '1980' | '1990' | '2000' | '2010' | '2090';
export type Variant = 'mild' | 'balanced' | 'cinematic';

export interface RenderRecord { variant: Variant; gsUri: string; width?: number; height?: number; sha256?: string; }

export const IScenes = DI.createInterface<SceneService>('IScenes', x => x.singleton(SceneService));
export type IScenes = SceneService;

export class SceneService {
  private storage = getStorage();
  private functions = getFunctions(undefined, 'us-central1');
  private http = resolve(IHttp);

  async createScene(eras: Era[] = ['1920', '1970', '2090'], title?: string): Promise<string> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in');
    const col = collection(db, 'scenes');
    const payload: { ownerUid: string; status: string; eras: Era[]; title: string | null; createdAt: FieldValue; updatedAt: FieldValue } = {
      ownerUid: uid,
      status: 'draft',
      eras,
      title: title || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(col, payload);
    return ref.id;
  }

  async uploadOriginal(sceneId: string, file: File): Promise<{ path: string; width: number; height: number; contentType: string }>{
    const contentType = file.type || 'image/jpeg';
    const base64 = await this.fileToBase64(file);
    const resp = await this.http.post<{ path: string; width: number; height: number; contentType: string }>(`/upload-original`, { sceneId, data: base64, mimeType: contentType });
    return resp;
  }

  async setOriginalMeta(sceneId: string, path: string, width: number, height: number): Promise<void> {
    // Build gs:// URI using the projectId for the default bucket
    const projectId = auth.app.options.projectId as string;
    const gsUri = `gs://${projectId}.appspot.com/${path}`;
    const ref = doc(db, 'scenes', sceneId);
    await updateDoc(ref, {
      original: { gsUri, width, height },
      updatedAt: serverTimestamp(),
    });
  }

  async renderEra(sceneId: string, era: Era, variant: Variant, negatives?: string, style?: string, reroll?: boolean): Promise<{ url: string; record: RenderRecord }>{
    type RenderEraInput = { sceneId: string; era: Era; variant: Variant; negatives?: string; style?: string; reroll?: boolean };
    const callable = httpsCallable<RenderEraInput, RenderRecord>(this.functions, 'renderEra');
    const record = await callable({ sceneId, era, variant, negatives, style, reroll }).then(r => r.data);
    const url = `/api/scene/${sceneId}/${era}/${variant}.jpg?ts=${Date.now()}`;
    return { url, record };
  }

  gsUriToPath(gsUri: string): string {
    if (!gsUri.startsWith('gs://')) return gsUri;
    const firstSlash = gsUri.indexOf('/', 5);
    return firstSlash > 0 ? gsUri.slice(firstSlash + 1) : gsUri;
  }

  async urlFromGsUri(gsUri: string): Promise<string> {
    try {
      const path = this.gsUriToPath(gsUri); // scenes/:sceneId/...
      const parts = path.split('/');
      if (parts.length >= 4 && parts[0] === 'scenes') {
        const sceneId = parts[1];
        if (parts[2] === 'renders' && parts.length >= 5) {
          const era = parts[3];
          const variantWithExt = parts[4];
          const variant = variantWithExt.replace(/\.jpg$/i, '') as Variant;
          return `/api/scene/${sceneId}/${era}/${variant}.jpg`;
        }
        if (parts[2].startsWith('original')) {
          return `/api/scene/${sceneId}/original.jpg`;
        }
      }
    } catch { /* ignore */ }
    // Fallback to original path if parsing fails (ensures no Storage call)
    return '/api/scene/unknown/original.jpg';
  }

  async getScene(sceneId: string): Promise<Record<string, unknown> | null> {
    const d = await getDoc(doc(db, 'scenes', sceneId));
    return d.exists() ? { id: d.id, ...d.data() } : null;
  }

  async publishScene(sceneId: string): Promise<{ publicId: string }>{
    const callable = httpsCallable<{ sceneId: string }, { publicId: string }>(this.functions, 'publishScene');
    const res = await callable({ sceneId });
    return res.data;
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private readImageSize(file: File): Promise<{ width: number; height: number }>{
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = URL.createObjectURL(file);
    });
  }
}
