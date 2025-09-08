import { DI } from '@aurelia/kernel';
import { resolve } from 'aurelia';
import { addDoc, collection, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../core/firebase';
import { IAuth } from './auth-service';

export interface GenerationRecord {
  id?: string;
  createdAt?: Timestamp;
  instructions?: string;
  target?: string;
  resultType: 'image' | 'text';
  resultMimeType?: string;
  // For demo purposes only: base64 image or text output
  resultData?: string;
  resultText?: string;
}

export const IHistory = DI.createInterface<HistoryService>('IHistory', x => x.singleton(HistoryService));
export type IHistory = HistoryService;

export class HistoryService {
  private auth = resolve(IAuth);
  private lsKey = 'chronolens.history.v1';

  private userPath() {
    const uid = this.auth.currentUser?.uid;
    return uid ? collection(db, 'users', uid, 'generations') : null;
  }

  async add(rec: GenerationRecord): Promise<void> {
    // Try Firestore first when signed in
    const col = this.userPath();
    const payload = {
      instructions: rec.instructions || null,
      target: rec.target || null,
      resultType: rec.resultType,
      resultMimeType: rec.resultMimeType || null,
      resultData: rec.resultData || null,
      resultText: rec.resultText || null,
      createdAt: serverTimestamp(),
    };
    if (col) {
      try { await addDoc(col, payload); return; } catch { /* fallback */ }
    }
    // Fallback: localStorage (best-effort)
    const items = this.getLocal();
    items.unshift({ ...rec, createdAt: Timestamp.fromDate(new Date()) });
    localStorage.setItem(this.lsKey, JSON.stringify(items.slice(0, 50)));
  }

  async list(limitCount = 20): Promise<GenerationRecord[]> {
    const col = this.userPath();
    if (col) {
      try {
        const snap = await getDocs(query(col, orderBy('createdAt', 'desc'), limit(limitCount)));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as GenerationRecord) }));
      } catch { /* fallback */ }
    }
    return this.getLocal().slice(0, limitCount);
  }

  observe(callback: (items: GenerationRecord[]) => void, limitCount = 20): () => void {
    const col = this.userPath();
    if (col) {
      try {
        const q = query(col, orderBy('createdAt', 'desc'), limit(limitCount));
        const unsub = onSnapshot(q, (snap) => {
          callback(snap.docs.map(d => ({ id: d.id, ...(d.data() as GenerationRecord) })));
        });
        return unsub;
      } catch { /* fallback */ }
    }
    // Fallback polling for local storage
    const tick = () => callback(this.getLocal().slice(0, limitCount));
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }

  private getLocal(): GenerationRecord[] {
    try { return JSON.parse(localStorage.getItem(this.lsKey) || '[]') as GenerationRecord[]; } catch { return []; }
  }
}

