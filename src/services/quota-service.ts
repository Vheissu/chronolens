import { DI } from '@aurelia/kernel';
import { getFunctions, httpsCallable } from 'firebase/functions';

export interface QuotaInfo { dailyRequests: number; dailyLimit: number }

export const IQuota = DI.createInterface<QuotaService>('IQuota', x => x.singleton(QuotaService));
export type IQuota = QuotaService;

export class QuotaService {
  private functions = getFunctions(undefined, 'us-central1');

  async get(): Promise<QuotaInfo> {
    const callable = httpsCallable<unknown, QuotaInfo>(this.functions, 'getQuota');
    const res = await callable();
    return res.data;
  }
}

