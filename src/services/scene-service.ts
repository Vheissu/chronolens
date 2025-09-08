import { DI } from '@aurelia/kernel';
import { addDoc, collection, doc, serverTimestamp, updateDoc, type FieldValue } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db } from '../core/firebase';

export type Era = '1920' | '1970' | '2090';
export type Variant = 'mild' | 'balanced' | 'cinematic';

export interface RenderRecord { variant: Variant; gsUri: string; width?: number; height?: number; sha256?: string; }

export const IScenes = DI.createInterface<SceneService>('IScenes', x => x.singleton(SceneService));
export type IScenes = SceneService;

export class SceneService {
  private storage = getStorage();
  private functions = getFunctions(undefined, 'us-central1');

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
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const path = `scenes/${sceneId}/original.${ext}`;
    const ref = storageRef(this.storage, path);
    await uploadBytes(ref, file, { contentType });
    const { width, height } = await this.readImageSize(file);
    return { path, width, height, contentType };
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

  async renderEra(sceneId: string, era: Era, variant: Variant, negatives?: string): Promise<{ url: string; record: RenderRecord }>{
    type RenderEraInput = { sceneId: string; era: Era; variant: Variant; negatives?: string };
    const callable = httpsCallable<RenderEraInput, RenderRecord>(this.functions, 'renderEra');
    const record = await callable({ sceneId, era, variant, negatives }).then(r => r.data);
    const path = this.gsUriToPath(record.gsUri);
    const url = await getDownloadURL(storageRef(this.storage, path));
    return { url, record };
  }

  private gsUriToPath(gsUri: string): string {
    if (!gsUri.startsWith('gs://')) return gsUri;
    const firstSlash = gsUri.indexOf('/', 5);
    return firstSlash > 0 ? gsUri.slice(firstSlash + 1) : gsUri;
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
