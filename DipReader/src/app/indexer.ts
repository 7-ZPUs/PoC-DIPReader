import { Injectable } from "@angular/core";

@Injectable({ providedIn: 'root' })
export class IndexerService {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(new URL('./sqlite-db.worker', import.meta.url), { type: 'module' });
    this.worker.postMessage({ type: 'INIT' });
  }

  async runIndexer() {
    console.log('Selezione directory...');

    const rootHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker();

    this.worker.postMessage({ type: 'INDEX', handle: rootHandle });

    this.worker.onmessage = async ({ data }) => {
      if (data.type === 'READY') {
        console.log('Sqlite DB pronto:', data.payload);
      }
    };
  }
}