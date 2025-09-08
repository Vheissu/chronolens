import { resolve } from 'aurelia';
import { IScenes } from '../services/scene-service';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../core/firebase';

export class PublicPage {
  private scenes = resolve(IScenes);
  publicId = '';
  coverUrl: string | null = null;
  error: string | null = null;

  async load(params: Record<string, string>): Promise<void> {
    this.publicId = params.id;
  }

  async attaching() {
    try {
      const snap = await getDoc(doc(db, 'public', this.publicId));
      if (!snap.exists()) { this.error = 'Not found'; return; }
      const data = snap.data() as { coverRef?: string };
      if (data && data.coverRef) {
        try { this.coverUrl = await this.scenes.urlFromGsUri(data.coverRef); } catch { /* ignore */ }
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load';
    }
  }
}
