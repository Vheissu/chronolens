import { IAuth } from '../services/auth-service';
import { IRouter } from '@aurelia/router';
import { AuthHook } from '../core/auth-hook';
import { resolve } from 'aurelia';
import { IScenes, type Era, type Variant } from '../services/scene-service';

export class DashboardPage {
  static dependencies = [AuthHook];
  private auth = resolve(IAuth);
  private get router() { return resolve(IRouter); }
  private scenes = resolve(IScenes);

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
  busy = false;
  sceneId: string | null = null;
  resultImage: string | null = null;
  error: string | null = null;

  async onPickSource(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.sourceFile = file;
    this.sourcePreview = file ? await this.toDataUrl(file) : null;
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
      const { path, width, height } = await this.scenes.uploadOriginal(this.sceneId, this.sourceFile);
      await this.scenes.setOriginalMeta(this.sceneId, path, width, height);
      // Render selected era/variant
      const { url } = await this.scenes.renderEra(this.sceneId, this.era, this.variant, this.negatives || undefined);
      this.resultImage = url;
    } catch (e: unknown) {
      console.error(e);
      this.error = this.errMsg(e);
    } finally {
      this.busy = false;
    }
  }

  downloadResult(): void {
    const url = this.resultImage;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chronolens-result';
    a.click();
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
}
