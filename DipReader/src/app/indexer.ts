import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { PersistenceService } from './services/persistence.service';

@Injectable({ providedIn: 'root' })
export class IndexerService {
  private worker: Worker;
  private indexed$ = new Subject<{ nodeCount: number | 'n/a'; dbBlob: Blob }>();
  private ready$ = new Subject<any>();
  private dbReady = false;
  private pendingFiles: File[][] = [];

  constructor(private persistence: PersistenceService) {
    this.worker = new Worker(new URL('./sqlite-db.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'READY') {
        console.log('Sqlite DB pronto:', data.payload);
        this.dbReady = true;
        this.ready$.next(data.payload);
        // Processa file in attesa
        if (this.pendingFiles.length > 0) {
          const files = this.pendingFiles.shift();
          if (files) this.sendFilesToWorker(files);
        }
      }
      if (data.type === 'ERROR') {
        console.error('Errore dal worker SQLite:', data.error);
        this.dbReady = false;
      }
      if (data.type === 'INDEXED') {
        console.log('Indicizzazione completata! Nodi:', data.nodeCount);
        if (data.dbBlob) {
          this.persistence.saveDb(data.dbBlob).catch(err => console.error('Errore salvataggio DB:', err));
        }
        this.indexed$.next({ nodeCount: data.nodeCount, dbBlob: data.dbBlob });
      }
    };

    this.worker.postMessage({ type: 'INIT' });
  }

  onIndexed() {
    return this.indexed$.asObservable();
  }

  onReady() {
    return this.ready$.asObservable();
  }

  async indexFiles(files: FileList): Promise<void> {
    if (!files || files.length === 0) {
      console.warn('Nessun file selezionato');
      alert('Seleziona almeno un file DIP.');
      return;
    }

    console.log('Invio', files.length, 'file al worker per indicizzazione...');
    const fileArray = Array.from(files);
    
    if (this.dbReady) {
      this.sendFilesToWorker(fileArray);
    } else {
      console.log('DB non ancora pronto, file in coda...');
      this.pendingFiles.push(fileArray);
    }
  }

  private sendFilesToWorker(files: File[]): void {
    this.worker.postMessage({ type: 'INDEX_FILES', files });
  }
}
