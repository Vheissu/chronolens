import { DI } from '@aurelia/kernel';
import { IHttp } from './http-client';
import { resolve } from 'aurelia';

export interface ImageInline { data: string; mimeType: string; }
export interface ImageRef { uri: string; mimeType?: string; }
export type ImageInput = ImageInline | ImageRef;

export interface ApplyTattooRequest {
  sourceImage: ImageInput;
  designs: ImageInput[];
  target?: string;
  instructions?: string;
  negatives?: string;
}

export interface ApplyTattooResponse {
  result: { type: 'image' | 'text'; mimeType?: string; data?: string; text?: string };
}

export const IGemini = DI.createInterface<GeminiService>('IGemini', x => x.singleton(GeminiService));
export type IGemini = GeminiService;

export class GeminiService {
  private http = resolve(IHttp);

  async fileToInline(file: File): Promise<ImageInline> {
    const mimeType = file.type || 'application/octet-stream';
    const base64 = await this.fileToBase64(file);
    return { data: base64, mimeType };
  }

  async applyTattoo(req: ApplyTattooRequest): Promise<ApplyTattooResponse> {
    return this.http.post<ApplyTattooResponse>('/gemini/apply-tattoo', req);
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

