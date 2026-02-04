import { Injectable } from '@angular/core';
import { DatabaseService } from '../database.service';
import { SearchFilter, FilterOptionGroup } from '../models/search-filter';

/**
 * Servizio per la gestione della ricerca e filtri
 * Centralizza la logica di ricerca, filtri e grouping delle opzioni
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private worker: Worker | undefined;
  private isWorkerReady: boolean = false;
  constructor(private dbService: DatabaseService) {
    this.initWorker();
  }

  private initWorker() {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('../db.worker.ts', import.meta.url));
     this.worker.onmessage = ({ data }) => {
        if (data.type === 'INIT_RESULT') {
          this.isWorkerReady = true;
          console.log('✅ AI Worker: Pronto (Modello caricato in memoria)');
        } else if (data.type === 'ERROR') {
          console.error('❌ AI Worker Error:', data.error);
        }
      };
      this.worker.postMessage({ 
        type: 'INIT', 
        payload: { wasmUrl: 'assets/sqlite3.wasm' } 
      });
    } else {
      console.error('Web Workers non supportati.');
    }
  }

  async searchSemantic(query: string): Promise<{id: number, score: number}[]> {
    if (!this.worker || !this.isWorkerReady) {
      console.warn('Worker non pronto, salto ricerca semantica.');
      return [];
    }

    return new Promise((resolve, reject) => {
      // Handler temporaneo per catturare la risposta specifica di questa ricerca
      const handler = ({ data }: MessageEvent) => {
        if (data.type === 'SEARCH_RESULT') {
          this.worker?.removeEventListener('message', handler);
          resolve(data.results); // Ritorna [{id: 1, score: 0.12}, ...]
        }
      };
      
      this.worker!.addEventListener('message', handler);
      this.worker!.postMessage({ type: 'SEARCH', payload: { query } });
    });
  }

  indexDocument(docId: number, metadataCombinedText: string) {
    if (this.worker) {
      this.worker.postMessage({
        type: 'INDEX_METADATA', // Assicurati che il worker gestisca questo case
        payload: { id: docId, text: metadataCombinedText }
      });
    }
  }

 async reindexAll(): Promise<void> {
    // 1. Catturiamo il riferimento al worker in una variabile locale.
    // Questo dice a TypeScript: "Usa QUESTA istanza specifica che so che esiste ora".
    const worker = this.worker;

    // Se non esiste, usciamo subito
    if (!worker) return;

    console.log('Service: Richiesta rigenerazione indici...');
    
    // Usiamo la variabile locale 'worker' invece di 'this.worker'
    worker.postMessage({ type: 'REINDEX_ALL' });

    return new Promise((resolve) => {
      const handler = ({ data }: MessageEvent) => {
        if (data.type === 'REINDEX_COMPLETE') {
          // TypeScript ora è felice perché 'worker' è una const definita sopra
          worker.removeEventListener('message', handler);
          console.log('✅ Service: Re-indicizzazione completata.');
          resolve();
        }
      };
      
      worker.addEventListener('message', handler);
    });
  }

  

  /**
   * Carica le chiavi disponibili per i filtri da tutti i file
   * @returns Lista di chiavi di metadati disponibili
   */
  async loadAvailableFilterKeys(): Promise<string[]> {
    return await this.dbService.getAvailableMetadataKeys();
  }

  groupFilterKeys(keys: string[]): FilterOptionGroup[] {
    const groups: { [groupLabel: string]: string[] } = {};

    // Raggruppa le chiavi per categoria
    keys.forEach(key => {
      const group = this.extractCategory(key);
      if (!groups[group]) groups[group] = [];
      groups[group].push(key);
    });

    // Converti in formato FilterOptionGroup
    return Object.entries(groups).map(([category, keyList]) => ({
      groupLabel: this.formatCategoryLabel(category),
      groupPath: category,
      options: keyList.map(key => ({
        value: key,
        label: this.formatKeyLabel(key)
      }))
    }));
  }



  async applyFilters(filters: SearchFilter[], freeTextQuery?: string): Promise<number[]> {

    let semanticIds: number[] | null = null;
    
    if (freeTextQuery && freeTextQuery.trim().length > 2) {
      console.log(`Avvio ricerca semantica per: "${freeTextQuery}"`);
      const semanticResults = await this.searchSemantic(freeTextQuery);
      semanticIds = semanticResults.map(r => r.id);
      console.log('Risultati semantici (IDs):', semanticIds);
    }
    const dbResults = await this.dbService.searchDocuments('', filters as any);
    const filterIds = dbResults
      .filter(node => node.type === 'file' && node.fileId)
      .map(node => node.fileId!);

    if (semanticIds !== null) {
      if (filters.length > 0) {
        return semanticIds.filter(id => filterIds.includes(id));
      } else {
        return semanticIds;
      }
    }
    return filterIds;
  }


  private extractCategory(key: string): string {
    if (key.includes('Data')) return 'Data';
    if (key.includes('Tipo')) return 'Tipo';
    if (key.includes('Soggetto') || key.includes('Mittente') || key.includes('Destinatario')) return 'Soggetti';
    if (key.includes('Protocoll')) return 'Protocollo';
    if (key.includes('Registr')) return 'Registrazione';
    return 'Altro';
  }

  private formatCategoryLabel(category: string): string {
    const labels: { [key: string]: string } = {
      'Data': 'Data',
      'Tipo': 'Tipo',
      'Soggetti': 'Soggetti',
      'Protocollo': 'Protocollo',
      'Registrazione': 'Registrazione',
      'Altro': 'Altro'
    };
    return labels[category] || category;
  }


  private formatKeyLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }
}
