import { resolve } from 'aurelia';
import { IScenes, type Era, type Variant } from '../services/scene-service';
import { collection, getDocs, query, where, orderBy, limit, type DocumentData } from 'firebase/firestore';
import { auth, db } from '../core/firebase';
import { IAuth } from '../services/auth-service';
import { IRouter } from '@aurelia/router';

type Output = { variant: Variant; gsUri: string; width?: number; height?: number; sha256?: string };
type SceneItem = {
  id: string;
  title?: string | null;
  createdAt?: unknown;
  outputs?: Partial<Record<Era, Output[]>>;
  coverEra?: Era;
  coverVariant?: Variant;
  coverUrl?: string;
  // Natural size of chosen cover (if known) – helps reserve space
  coverWidth?: number;
  coverHeight?: number;
};

export class ScenesPage {
  private scenes = resolve(IScenes);
  public auth = resolve(IAuth);
  private get router() { return resolve(IRouter); }

  items: SceneItem[] = [];
  busy = false;
  error: string | null = null;

  async canLoad(): Promise<boolean> {
    if (!this.auth.isLoggedIn || this.auth.isAnonymous) {
      await this.router.load('generate');
      return false;
    }
    return true;
  }

  async attaching() {
    await this.load();
  }

  async load(): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) { this.items = []; return; }
    this.busy = true; this.error = null;
    try {
      const col = collection(db, 'scenes');
      const snap = await getDocs(query(col, where('ownerUid', '==', uid), orderBy('createdAt', 'desc'), limit(30)));
      const raw = snap.docs.map(d => ({ id: d.id, ...(d.data() as DocumentData) }));
      const out: SceneItem[] = [];
      for (const r of raw) {
        const outputs = (r.outputs || {}) as SceneItem['outputs'];
        let coverEra: Era | undefined;
        let coverVariant: Variant | undefined;
        let coverWidth: number | undefined;
        let coverHeight: number | undefined;
        if (outputs) {
          const eras: Era[] = ['1890','1920','1940','1970','1980','1990','2000','2010','2090'];
          for (const e of eras) {
            const arr = (outputs as Record<string, Output[]>)[e] as Output[] | undefined;
            if (arr && arr.length) {
              const c = arr.find(x => x.variant === 'balanced') || arr[0];
              coverEra = e;
              coverVariant = c.variant;
              // Capture natural dimensions when available
              if (c.width && c.height) { coverWidth = c.width; coverHeight = c.height; }
              break;
            }
          }
        }
        let coverUrl: string | undefined;
        if (coverEra && coverVariant) {
          try { coverUrl = await this.scenes.renderUrl(r.id, coverEra, coverVariant); } catch { /* ignore */ }
        }
        out.push({
          id: r.id,
          title: r.title || null,
          createdAt: r.createdAt,
          outputs,
          coverEra,
          coverVariant,
          coverUrl,
          coverWidth,
          coverHeight,
        });
      }
      this.items = out;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load scenes';
    } finally {
      this.busy = false;
    }
  }
}
