import { DI } from '@aurelia/kernel';
import { HttpClient, json } from '@aurelia/fetch-client';
import { resolve } from 'aurelia';
import { IAuth } from './auth-service';

export const IHttp = DI.createInterface<Http>("IHttp", x => x.singleton(Http));
export type IHttp = Http;

export class Http {
  private client: HttpClient;
  private auth = resolve(IAuth);

  private baseUrl = (() => {
    try {
      // Vite provides import.meta.env
      const env = (import.meta as unknown as { env?: Record<string, string> }).env;
      return env?.VITE_API_BASE || '/api';
    } catch {
      return '/api';
    }
  })();

  constructor() {
    this.client = new HttpClient();
    this.client.configure((config) => {
      config.withBaseUrl(this.baseUrl);
      config.withInterceptor({
        request: async (request) => {
          try {
            const token = await this.auth.getToken();
            if (token?.token) {
              request.headers.set('Authorization', `Bearer ${token.token}`);
            }
          } catch { /* unauthenticated */ }
          return request;
        },
      });
      return config;
    });
  }

  fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    return this.client.fetch(input, init);
  }

  // Convenience
  get<T = unknown>(path: string): Promise<T> {
    return this.fetch(path).then(r => this.toJson<T>(r));
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.fetch(path, { method: 'POST', body: body ? json(body) : undefined })
      .then(r => this.toJson<T>(r));
  }

  private async toJson<T>(resp: Response): Promise<T> {
    if (!resp.ok) {
      let message = `${resp.status} ${resp.statusText}`;
      try {
        const err = await resp.json();
        if (err?.error) message = err.error;
      } catch { /* noop */ }
      throw new Error(message);
    }
    return resp.json() as Promise<T>;
  }
}

