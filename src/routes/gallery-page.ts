import { resolve } from 'aurelia';
import { collection, getDocs, limit, orderBy, query, startAfter, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
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
  coverEra?: Era;
  coverVariant?: Variant;
  createdAt?: Date;
};

export class GalleryPage {
  private scenes = resolve(IScenes);

  // Loaded (unfiltered) items
  items: GalleryItem[] = [];
  // Filters
  filterEra: '' | Era = '';
  filterVariant: '' | Variant = '';
  // Pagination state
  private lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
  private pageSize = 24;
  hasMore = false;
  busy = false;
  error: string | null = null;

  async attaching() {
    await this.load();
  }

  get visibleItems(): GalleryItem[] {
    return this.items.filter(it => (!this.filterEra || it.coverEra === this.filterEra) && (!this.filterVariant || it.coverVariant === this.filterVariant));
  }

  async load(reset = true): Promise<void> {
    this.busy = true; this.error = null;
    if (reset) { this.items = []; this.lastDoc = null; this.hasMore = false; }
    try {
      const col = collection(db, 'public');
      const q = this.lastDoc
        ? query(col, orderBy('createdAt', 'desc'), startAfter(this.lastDoc), limit(this.pageSize))
        : query(col, orderBy('createdAt', 'desc'), limit(this.pageSize));
      const snap = await getDocs(q);
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
        } else if (d.sceneId && d.coverRef) {
          try { coverUrl = await this.scenes.urlFromGsUri(d.coverRef, d.sceneId); } catch { try { coverUrl = await this.scenes.originalUrl(d.sceneId); } catch { /* ignore */ } }
        } else if (d.sceneId) {
          try { coverUrl = await this.scenes.originalUrl(d.sceneId); } catch { /* ignore */ }
        }
        out.push({ sceneId: d.sceneId, publicId: d.publicId, coverUrl, createdAt, coverEra: d.coverEra, coverVariant: d.coverVariant });
      }
      this.items = reset ? out : [...this.items, ...out];
      this.lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : this.lastDoc;
      this.hasMore = snap.docs.length === this.pageSize;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load gallery';
    } finally {
      this.busy = false;
    }
  }

  async loadMore(): Promise<void> {
    if (this.busy || !this.hasMore) return;
    await this.load(false);
  }

  clearFilters(): void { this.filterEra = ''; this.filterVariant = ''; }
}
