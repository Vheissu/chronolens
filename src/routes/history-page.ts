import { IHistory, type GenerationRecord } from '../services/history-service';
import { DI } from '@aurelia/kernel';

export class HistoryPage {
  static inject = [IHistory as unknown as DI.InterfaceSymbol<IHistory>];
  constructor(private history: IHistory) {}

  items: GenerationRecord[] = [];
  unsub: (() => void) | null = null;

  attaching() {
    this.unsub = this.history.observe((items) => this.items = items, 30);
  }
  detaching() { try { this.unsub?.(); } catch { /* ignore */ } }
}

