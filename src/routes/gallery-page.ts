import { resolve } from 'aurelia';
import { collection, getDocs, limit, orderBy, query, type DocumentData } from 'firebase/firestore';
import { db } from '../core/firebase';
import { IScenes, type Era, type Variant } from '../services/scene-service';

type PublicDoc = {
  sceneId: string;
  publicId: string;
  coverEra?: Era;
  coverVariant?: Variant;
  coverRef?: string;
  createdAt?: { toDate?: () => Date } | unknown;
};

type GalleryItem = {
  sceneId: string;
  publicId: string;
  coverUrl?: string;
  createdAt?: Date;
};

export class GalleryPage {
  private scenes = resolve(IScenes);

  items: GalleryItem[] = [];
  busy = false;
  error: string | null = null;

  async attaching() {
    await this.load();
  }

  async load(): Promise<void> {
    this.busy = true; this.error = null; this.items = [];
    try {
      const col = collection(db, 'public');
      const snap = await getDocs(query(col, orderBy('createdAt', 'desc'), limit(30)));
      const docs = snap.docs.map(d => {
        const data = d.data() as DocumentData;
        return {
          publicId: d.id,
          sceneId: data.sceneId as string,
          coverEra: data.coverEra as Era | undefined,
          coverVariant: data.coverVariant as Variant | undefined,
          coverRef: data.coverRef as string | undefined,
          createdAt: data.createdAt as unknown,
        } as PublicDoc;
      });
      const out: GalleryItem[] = [];
      for (const d of docs) {
        const ts = d.createdAt as { toDate?: () => Date } | undefined;
        const createdAt = ts?.toDate ? ts.toDate() : undefined;
        let coverUrl: string | undefined;
        if (d.sceneId && d.coverEra && d.coverVariant) {
          try { coverUrl = await this.scenes.renderUrl(d.sceneId, d.coverEra, d.coverVariant); } catch { /* ignore */ }
        } else if (d.coverRef) {
          try { coverUrl = await this.scenes.urlFromGsUri(d.coverRef); } catch { /* ignore */ }
        }
        out.push({ sceneId: d.sceneId, publicId: d.publicId, coverUrl, createdAt });
      }
      this.items = out;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load gallery';
    } finally {
      this.busy = false;
    }
  }
}
