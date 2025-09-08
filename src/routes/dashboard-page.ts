import { IAuth } from '../services/auth-service';
import { IRouter } from '@aurelia/router';
import { AuthHook } from '../core/auth-hook';
import { resolve } from 'aurelia';
import { IScenes, type Era, type Variant } from '../services/scene-service';
import { IQuota, type QuotaInfo } from '../services/quota-service';

export class DashboardPage {
  static dependencies = [AuthHook];
  public auth = resolve(IAuth);
  private get router() { return resolve(IRouter); }
  private scenes = resolve(IScenes);
  private quotaSvc = resolve(IQuota);

  async canLoad(): Promise<boolean> {
    if (!this.auth.isLoggedIn) {
      await this.router.load('login');
      return false;
    }
    return true;
  }

  // UI state
  sourceFile: File | null = null;
  sourcePreview: string | null = null;
  era: Era = '1920';
  variant: Variant = 'balanced';
  negatives = '';
  stylePreset = '';
  busy = false;
  sceneId: string | null = null;
  resultImage: string | null = null;
  error: string | null = null;
  quota: QuotaInfo | null = null;
  compare = 50; // before/after slider percent

  async attaching() {
    await this.refreshQuota();
  }

  async onPickSource(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file) {
      const okType = ['image/jpeg','image/png','image/webp'].includes((file.type || '').toLowerCase());
      const okSize = file.size <= 5 * 1024 * 1024;
      if (!okType) { this.error = 'Unsupported file type. Use JPEG/PNG/WebP.'; this.sourceFile = null; this.sourcePreview = null; return; }
      if (!okSize) { this.error = 'File exceeds 5 MB limit.'; this.sourceFile = null; this.sourcePreview = null; return; }
      this.sourceFile = file;
      this.sourcePreview = await this.toDataUrl(file);
    } else {
      this.sourceFile = null;
      this.sourcePreview = null;
    }
  }

  async generate(): Promise<void> {
    if (!this.sourceFile) return;
    this.busy = true;
    this.error = null;
    this.resultImage = null;
    try {
      // Create a new scene if needed
      if (!this.sceneId) {
        this.sceneId = await this.scenes.createScene();
      }
      // Upload original and attach metadata
      await this.scenes.uploadOriginal(this.sceneId, this.sourceFile);
      // Render selected era/variant
      const { url } = await this.scenes.renderEra(this.sceneId, this.era, this.variant, this.negatives || undefined, this.stylePreset || undefined);
      this.resultImage = url;
      await this.refreshQuota();
    } catch (e: unknown) {
      console.error(e);
      this.error = this.errMsg(e);
    } finally {
      this.busy = false;
    }
  }

  async reroll(): Promise<void> {
    if (!this.sceneId) return;
    this.busy = true; this.error = null;
    try {
      const { url } = await this.scenes.renderEra(this.sceneId, this.era, this.variant, this.negatives || undefined, this.stylePreset || undefined, true);
      this.resultImage = url;
      await this.refreshQuota();
    } catch (e: unknown) {
      console.error(e);
      this.error = this.errMsg(e);
    } finally {
      this.busy = false;
    }
  }

  randomize(): void {
    const eras: Era[] = ['1890','1920','1940','1970','1980','1990','2000','2010','2090'];
    const variants: Variant[] = ['mild','balanced','cinematic'];
    const styles = ['',
      'Noir black-and-white with deep contrast',
      'Faded postcard toning and soft vignette',
      'VHS cassette artifacts and slight chroma bleed',
      'Polaroid instant film look',
      'Cyberpunk neon glow and reflective materials',
      'Kodachrome film palette and grain',
      'Sepia tone and paper texture',
    ];
    this.era = eras[Math.floor(Math.random()*eras.length)];
    this.variant = variants[Math.floor(Math.random()*variants.length)];
    this.stylePreset = styles[Math.floor(Math.random()*styles.length)];
  }

  async downloadResult(): Promise<void> {
    if (!this.sceneId) return;
    const era = this.era;
    const variant = this.variant;
    const filename = `chronolens-${this.sceneId}-${era}-${variant}.jpg`;
    const url = await this.scenes.downloadUrl(this.sceneId, era, variant, filename);
    window.open(url, '_blank');
  }

  private toDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private errMsg(err: unknown): string {
    if (err instanceof Error && typeof err.message === 'string') return err.message;
    try { return String(err); } catch { return 'Failed to generate image'; }
  }

  private async refreshQuota(): Promise<void> {
    try { this.quota = await this.quotaSvc.get(); } catch { /* ignore quota fetch */ }
  }
}
