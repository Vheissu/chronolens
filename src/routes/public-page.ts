import { resolve } from 'aurelia';
import { IScenes, type Era, type Variant } from '../services/scene-service';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../core/firebase';

export class PublicPage {
  private scenes = resolve(IScenes);
  publicId = '';
  // Display
  originalUrl: string | null = null;
  resultUrl: string | null = null;
  // Controls
  compare = 50;
  private dragging = false;
  modalOpen = false;
  error: string | null = null;

  async loading(params: Record<string, string>): Promise<void> {
    this.publicId = params.id;
  }

  async attaching() {
    try {
      const snap = await getDoc(doc(db, 'public', this.publicId));
      if (!snap.exists()) { this.error = 'Not found'; return; }
      const data = snap.data() as { coverRef?: string; coverEra?: string; coverVariant?: string; sceneId?: string };
      const sceneId = data.sceneId as string | undefined;
      if (!sceneId) { this.error = 'Missing scene reference'; return; }
      try { this.originalUrl = await this.scenes.originalUrl(sceneId); } catch { this.originalUrl = null; }
      if (data.coverEra && data.coverVariant) {
        try { this.resultUrl = await this.scenes.renderUrl(sceneId, data.coverEra as Era, data.coverVariant as Variant); } catch { this.resultUrl = null; }
      } else if (data.coverRef) {
        try { this.resultUrl = await this.scenes.urlFromGsUri(data.coverRef, sceneId); } catch { this.resultUrl = null; }
      }

      // If we still don't have a result URL, read the scene doc and pick an available output
      if (!this.resultUrl) {
        const sceneSnap = await getDoc(doc(db, 'scenes', sceneId));
        if (sceneSnap.exists()) {
          const sdata = sceneSnap.data() as { outputs?: Record<string, Array<{ variant: Variant; gsUri: string }>> };
          const outputs = (sdata?.outputs || {}) as Record<string, Array<{ variant: Variant; gsUri: string }>>;
          const orderedEras: Era[] = ['1890','1920','1940','1970','1980','1990','2000','2010','2090'];
          let chosen: { era: Era; variant: Variant; gsUri?: string } | null = null;
          for (const e of orderedEras) {
            const arr = outputs[e] || [];
            if (arr.length) {
              const bal = arr.find(x => x.variant === 'balanced' as Variant) || arr[0];
              chosen = { era: e as Era, variant: bal.variant as Variant, gsUri: bal.gsUri };
              break;
            }
          }
          if (chosen) {
            try { this.resultUrl = await this.scenes.renderUrl(sceneId, chosen.era, chosen.variant); }
            catch { try { if (chosen.gsUri) this.resultUrl = await this.scenes.urlFromGsUri(chosen.gsUri, sceneId); } catch { /* ignore */ } }
          }
        }
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load';
    }
  }

  // Compare slider interactions
  openModal(): void { this.modalOpen = true; }
  closeModal(): void { this.modalOpen = false; }
  noop(ev: Event): void { ev.stopPropagation(); }
  onSliderStart(ev: PointerEvent): void { this.dragging = true; this.updateCompareFromEvent(ev); }
  onSliderMove(ev: PointerEvent): void { if (!this.dragging) return; this.updateCompareFromEvent(ev); }
  onSliderEnd(): void { this.dragging = false; }
  private updateCompareFromEvent(ev: PointerEvent): void {
    const el = ev.currentTarget as HTMLElement | null; if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width);
    this.compare = Math.round((x / rect.width) * 100);
  }

  async downloadSelected(): Promise<void> {
    // Prefer result for download; fall back to original
    if (this.resultUrl) { window.open(this.resultUrl, '_blank'); return; }
    if (this.originalUrl) { window.open(this.originalUrl, '_blank'); }
  }
}
