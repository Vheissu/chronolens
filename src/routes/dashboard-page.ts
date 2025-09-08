import { IAuth } from '../services/auth-service';
import { IRouter } from '@aurelia/router';
import { AuthHook } from '../core/auth-hook';
import { IGemini } from '../services/gemini-service';
import { IHistory } from '../services/history-service';
import { resolve } from 'aurelia';

export class DashboardPage {
  static dependencies = [AuthHook];
  private auth = resolve(IAuth);
  private router = resolve(IRouter);
  private gemini = resolve(IGemini);
  private history = resolve(IHistory);

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
  designFiles: File[] = [];
  designPreviews: string[] = [];
  instructions = '';
  negatives = '';
  target = '';
  busy = false;
  resultImage: string | null = null;
  resultText: string | null = null;

  async onPickSource(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.sourceFile = file;
    this.sourcePreview = file ? await this.toDataUrl(file) : null;
  }

  async onPickDesigns(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files).slice(0, 3) : [];
    this.designFiles = files;
    this.designPreviews = await Promise.all(files.map(f => this.toDataUrl(f)));
  }

  async generate(): Promise<void> {
    if (!this.sourceFile) return;
    this.busy = true;
    this.resultImage = null; this.resultText = null;
    try {
      const sourceImage = await this.gemini.fileToInline(this.sourceFile);
      const designs = await Promise.all(this.designFiles.map(f => this.gemini.fileToInline(f)));
      const resp = await this.gemini.applyTattoo({ sourceImage, designs, target: this.target || undefined, instructions: this.instructions || undefined, negatives: this.negatives || undefined });
      if (resp.result.type === 'image' && resp.result.mimeType && resp.result.data) {
        this.resultImage = `data:${resp.result.mimeType};base64,${resp.result.data}`;
        await this.history.add({ resultType: 'image', resultMimeType: resp.result.mimeType, resultData: resp.result.data, target: this.target, instructions: this.instructions });
      } else if (resp.result.type === 'text' && resp.result.text) {
        this.resultText = resp.result.text;
        await this.history.add({ resultType: 'text', resultText: resp.result.text, target: this.target, instructions: this.instructions });
      }
    } catch (e) {
      // Surface minimal error via console; production could use snackbar
      console.error(e);
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
}
