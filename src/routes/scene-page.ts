import { IScenes, type Era, type Variant } from '../services/scene-service';
import { resolve } from 'aurelia';

type Output = { variant: Variant; gsUri: string; width?: number; height?: number; sha256?: string };

export class ScenePage {
  private scenes = resolve(IScenes);

  sceneId = '';
  scene: Record<string, unknown> | null = null;
  loading = true;
  error: string | null = null;

  selectedEra: Era = '1920';
  selectedVariant: Variant = 'balanced';
  stylePreset = '';
  negatives = '';
  compare = 50;
  originalUrl: string | null = null;
  resultUrl: string | null = null;
  publishing = false;
  publicUrl: string | null = null;

  async load(params: Record<string, string>): Promise<void> {
    this.sceneId = params.id;
  }

  async attaching() {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading = true; this.error = null; this.resultUrl = null; this.originalUrl = null;
    try {
      this.scene = await this.scenes.getScene(this.sceneId);
      if (!this.scene) { this.error = 'Scene not found'; return; }
      const original = (this.scene?.original as { gsUri?: string } | undefined);
      if (original?.gsUri) {
        this.originalUrl = await this.scenes.originalUrl(this.sceneId);
      }
      // Default era from doc if present
      const eras: Era[] = this.scene?.eras || ['1890','1920','1940','1970','1980','1990','2000','2010','2090'];
      if (eras?.length) this.selectedEra = eras[0];
      await this.selectExisting();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load scene';
    } finally {
      this.loading = false;
    }
  }

  private async selectExisting(): Promise<void> {
    const outputs = ((this.scene?.outputs as Record<string, Output[]> | undefined)?.[this.selectedEra] || []) as Output[];
    const found = outputs.find(o => o.variant === this.selectedVariant) || outputs[0];
    if (found) {
      this.resultUrl = await this.scenes.renderUrl(this.sceneId, this.selectedEra, this.selectedVariant);
    } else {
      this.resultUrl = null;
    }
  }

  async generate(): Promise<void> {
    try {
      await this.scenes.renderEra(this.sceneId, this.selectedEra, this.selectedVariant, this.negatives || undefined, this.stylePreset || undefined);
      this.resultUrl = await this.scenes.renderUrl(this.sceneId, this.selectedEra, this.selectedVariant);
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to render era';
    }
  }

  async reroll(): Promise<void> {
    try {
      await this.scenes.renderEra(this.sceneId, this.selectedEra, this.selectedVariant, this.negatives || undefined, this.stylePreset || undefined, true);
      this.resultUrl = await this.scenes.renderUrl(this.sceneId, this.selectedEra, this.selectedVariant);
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to render era';
    }
  }

  async publish(): Promise<void> {
    this.publishing = true; this.error = null;
    try {
      const { publicId } = await this.scenes.publishScene(this.sceneId);
      this.publicUrl = `${location.origin}/p/${publicId}`;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to publish scene';
    } finally {
      this.publishing = false;
    }
  }
}
