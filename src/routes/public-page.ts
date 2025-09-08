import { resolve } from 'aurelia';
import { IScenes } from '../services/scene-service';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../core/firebase';

export class PublicPage {
  private scenes = resolve(IScenes);
  publicId = '';
  coverUrl: string | null = null;
  error: string | null = null;

  async loading(params: Record<string, string>): Promise<void> {
    this.publicId = params.id;
  }

  async attaching() {
    try {
      const snap = await getDoc(doc(db, 'public', this.publicId));
      if (!snap.exists()) { this.error = 'Not found'; return; }
      const data = snap.data() as { coverRef?: string; coverEra?: string; coverVariant?: string; sceneId?: string };
      if (data?.sceneId && data?.coverEra && data?.coverVariant) {
        this.coverUrl = `/api/scene/${data.sceneId}/${data.coverEra}/${data.coverVariant}.jpg`;
      } else if (data?.sceneId && data?.coverRef) {
        // Fallback for older published docs: support gs:// and https storage URLs; fall back to original by id
        try { this.coverUrl = await this.scenes.urlFromGsUri(data.coverRef, data.sceneId); } catch { this.coverUrl = await this.scenes.originalUrl(data.sceneId); }
      } else if (data?.sceneId) {
        // As a last resort, try original by id
        this.coverUrl = await this.scenes.originalUrl(data.sceneId);
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load';
    }
  }
}
