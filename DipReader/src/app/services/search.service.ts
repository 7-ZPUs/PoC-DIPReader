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

  async searchSemantic(query: string | number[]): Promise<{id: number, score: number}[]> {
    if (!this.worker || !this.isWorkerReady) {
      console.warn('Worker non pronto, salto ricerca semantica.');
      return [];
    }

    return new Promise((resolve, reject) => {
      const handler = ({ data }: MessageEvent) => {
        if (data.type === 'SEARCH_RESULT') {
          this.worker?.removeEventListener('message', handler);
          resolve(data.results);
        }
      };
      
      this.worker!.addEventListener('message', handler);
      this.worker!.postMessage({ type: 'SEARCH', payload: { query } });
    });
  }

  indexDocument(docId: number, metadataCombinedText: string) {
    if (this.worker) {
      this.worker.postMessage({
        type: 'INDEX_METADATA',
        payload: { id: docId, text: metadataCombinedText }
      });
    }
  }

  /**
   * Re-indicizza tutti i documenti recuperandoli dal database
   * e inviandoli al worker per l'indicizzazione semantica
   */
  async reindexAll(): Promise<void> {
    const worker = this.worker;

    if (!worker) {
      console.error('Service: Worker non disponibile');
      return;
    }
    
    if (!this.isWorkerReady) {
      console.error('Service: Worker non ancora pronto');
      return;
    }

    console.log('Service: Richiesta rigenerazione indici...');
    
    try {
      // 1. RECUPERA I DOCUMENTI DAL DATABASE
      console.log('Service: Recupero documenti dal database...');
      const documents = await this.fetchAllDocumentsWithMetadata();
      
      if (documents.length === 0) {
        console.warn('Service: Nessun documento trovato da indicizzare');
        return;
      }
      
      console.log(`Service: Trovati ${documents.length} documenti, invio al worker...`);
      
      // 2. INVIA I DOCUMENTI AL WORKER
      worker.postMessage({ 
        type: 'REINDEX_ALL',
        payload: { documents } // ← QUESTO ERA MANCANTE!
      });

      // 3. ATTENDI IL COMPLETAMENTO
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          worker.removeEventListener('message', handler);
          reject(new Error('Timeout reindexing (5 minuti)'));
        }, 300000); // 5 minuti
        
        const handler = ({ data }: MessageEvent) => {
          if (data.type === 'REINDEX_COMPLETE') {
            clearTimeout(timeout);
            worker.removeEventListener('message', handler);
            console.log('✅ Service: Re-indicizzazione completata.');
            resolve();
          } else if (data.type === 'ERROR') {
            clearTimeout(timeout);
            worker.removeEventListener('message', handler);
            console.error('❌ Service: Errore durante reindexing:', data.error);
            reject(new Error(data.error.message || 'Errore sconosciuto'));
          }
        };
        
        worker.addEventListener('message', handler);
      });
      
    } catch (error) {
      console.error('Service: Errore nel reindexing:', error);
      throw error;
    }
  }

  /**
   * Recupera tutti i documenti navigando l'albero completo
   */
  private async fetchAllDocumentsWithMetadata(): Promise<Array<{id: number, text: string}>> {
    try {
      // 1. Recupera l'albero completo dal DB
      const roots = await this.dbService.searchDocuments('', []);
      console.log(`Service: Albero recuperato con ${roots.length} nodi radice.`);

      // 2. FUNZIONE HELPER: Appiattisce l'albero per estrarre tutti i file
      const extractFilesRecursively = (nodes: any[]): any[] => {
        let files: any[] = [];
        for (const node of nodes) {
          // Se è un file, lo prendiamo
          if (node.type === 'file' && node.fileId) {
            files.push(node);
          }
          // Se è una cartella (o ha figli), scendiamo in profondità
          if (node.children && node.children.length > 0) {
            files = files.concat(extractFilesRecursively(node.children));
          }
        }
        return files;
      };

      // 3. Estraiamo la lista piatta di tutti i file
      const allFiles = extractFilesRecursively(roots);
      console.log(`Service: Estratti ${allFiles.length} file totali dall'albero.`);
      
      const documents: Array<{id: number, text: string}> = [];
      
      // 4. Processa ogni file trovato
      for (const node of allFiles) {
          try {
            // Recupera metadati specifici per il file o documento
            const metadata = await this.dbService.getDocumentMetadata(node.fileId);
            
            const metadataText = metadata
              .map(m => `${m.meta_key}: ${m.meta_value}`)
              .join('. ');
            
            // Testo combinato per l'AI
            const combinedText = (metadataText || '') + ` File: ${node.name}`;
            
            documents.push({
              id: node.fileId,
              text: combinedText
            });
            
          } catch (err) {
            console.warn(`Service: Errore metadati per file ${node.fileId}`, err);
            documents.push({ id: node.fileId, text: node.name });
          }
      }
      
      console.log(`Service: Preparati ${documents.length} documenti per l'AI.`);
      return documents;
      
    } catch (error) {
      console.error('Service: Errore recupero documenti:', error);
      return [];
    }
  }

  /**
   * Carica le chiavi disponibili per i filtri da tutti i file
   */
  async loadAvailableFilterKeys(): Promise<string[]> {
    return await this.dbService.getAvailableMetadataKeys();
  }

  groupFilterKeys(keys: string[]): FilterOptionGroup[] {
    const groups: { [groupLabel: string]: string[] } = {};

    keys.forEach(key => {
      const group = this.extractCategory(key);
      if (!groups[group]) groups[group] = [];
      groups[group].push(key);
    });

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
    
    // Ricerca semantica se c'è una query testuale
    if (freeTextQuery && freeTextQuery.trim().length > 2) {
      console.log(`Avvio ricerca semantica per: "${freeTextQuery}"`);
      const semanticResults = await this.searchSemantic(freeTextQuery);
      semanticIds = semanticResults.map(r => r.id);
      console.log('Risultati semantici (IDs):', semanticIds);
    }
    
    // Ricerca per metadati
    const dbResults = await this.dbService.searchDocuments('', filters as any);
    const filterIds = dbResults
      .filter(node => node.type === 'file' && node.fileId)
      .map(node => node.fileId!);

    // Combina i risultati
    if (semanticIds !== null) {
      if (filters.length > 0) {
        // Intersezione: documenti che matchano ENTRAMBI i criteri
        return semanticIds.filter(id => filterIds.includes(id));
      } else {
        // Solo ricerca semantica
        return semanticIds;
      }
    }
    
    // Solo ricerca per metadati
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

  async getEmbeddingDebug(text: string): Promise<number[]> {
  if (!this.worker || !this.isWorkerReady) throw new Error('Worker AI non pronto');

  return new Promise((resolve, reject) => {
    const handler = ({ data }: MessageEvent) => {
      if (data.type === 'EMBEDDING_GENERATED') {
        this.worker?.removeEventListener('message', handler);
        // Convertiamo Float32Array in array normale per facilità di gestione in Angular
        resolve(Array.from(data.vector));
      } else if (data.type === 'ERROR') {
        this.worker?.removeEventListener('message', handler);
        reject(new Error(data.error.message));
      }
    };

    this.worker!.addEventListener('message', handler);
    this.worker!.postMessage({
      type: 'GENERATE_EMBEDDING',
      payload: { text }
    });
  });
}
}