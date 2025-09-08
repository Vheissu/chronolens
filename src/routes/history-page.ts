import { IHistory, type GenerationRecord } from '../services/history-service';
import { resolve } from 'aurelia';

export class HistoryPage {
  private history = resolve(IHistory);

  items: GenerationRecord[] = [];
  unsub: (() => void) | null = null;

  attaching() {
    this.unsub = this.history.observe((items) => this.items = items, 30);
  }
  detaching() { try { this.unsub?.(); } catch { /* ignore */ } }
}
