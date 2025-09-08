import { resolve } from 'aurelia';
import { IScenes, type Era, type Variant } from '../services/scene-service';
import { collection, getDocs, query, where, orderBy, limit, type DocumentData } from 'firebase/firestore';
import { auth, db } from '../core/firebase';

type Output = { variant: Variant; gsUri: string; width?: number; height?: number; sha256?: string };
type SceneItem = { id: string; title?: string | null; createdAt?: unknown; outputs?: Partial<Record<Era, Output[]>>; coverEra?: Era; coverVariant?: Variant };

export class ScenesPage {
  private scenes = resolve(IScenes);

  items: SceneItem[] = [];
  busy = false;
  error: string | null = null;

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
        if (outputs) {
          const eras: Era[] = ['1890','1920','1940','1970','1980','1990','2000','2010','2090'];
          for (const e of eras) {
            const arr = (outputs as Record<string, Output[]>)[e] as Output[] | undefined;
            if (arr && arr.length) { const c = arr.find(x => x.variant === 'balanced') || arr[0]; coverEra = e; coverVariant = c.variant; break; }
          }
        }
        out.push({ id: r.id, title: r.title || null, createdAt: r.createdAt, outputs, coverEra, coverVariant });
      }
      this.items = out;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load scenes';
    } finally {
      this.busy = false;
    }
  }
}
