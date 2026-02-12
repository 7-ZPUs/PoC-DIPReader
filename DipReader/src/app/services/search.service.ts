import { Injectable } from '@angular/core';
import { DatabaseService } from '../database-electron.service';
import { SearchFilter, FilterOptionGroup } from '../models/search-filter';

/**
 * Servizio per la gestione della ricerca e filtri
 * Centralizza la logica di ricerca, filtri e grouping delle opzioni
 * Utilizza Electron IPC per la ricerca semantica tramite il main process
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private isAiReady: boolean = false;
  
  constructor(private dbService: DatabaseService) {
    this.initAI();
  }

  private async initAI() {
    try {
      console.log('Initializing AI model in main process...');
      const result = await window.electronAPI.ai.init();
      this.isAiReady = true;
      console.log('AI Model ready:', result);
    } catch (error) {
      console.error('AI initialization error:', error);
      this.isAiReady = false;
    }
  }

  async searchSemantic(query: string | number[]): Promise<{id: number, score: number}[]> {
    if (!this.isAiReady) {
      console.warn('AI model not ready, skipping semantic search.');
      return [];
    }

    try {
      const response = await window.electronAPI.ai.search(query);
      
      if (Array.isArray(response)) {
        return response;
      } else if (response && Array.isArray(response.results)) {
        return response.results;
      }
      
      console.warn('Formato risposta AI imprevisto:', response);
      return [];
    } catch (error) {
      console.error('Semantic search error:', error);
      return [];
    }
  }

  async indexDocument(docId: number, metadataCombinedText: string) {
    if (this.isAiReady) {
      try {
        await window.electronAPI.ai.index({id: docId, text: metadataCombinedText});
      } catch (error) {
        console.error('Error indexing document:', error);
      }
    }
  }

  /**
   * Re-indicizza tutti i documenti recuperandoli dal database
   * e inviandoli al worker per l'indicizzazione semantica
   */
  async reindexAll(): Promise<void> {
    if (!this.isAiReady) {
      console.error('Service: AI model not ready');
      return;
    }

    console.log('Service: Starting reindexing...');
    
    try {
      // 1. FETCH DOCUMENTS FROM DATABASE
      console.log('Service: Fetching documents from database...');
      const documents = await this.fetchAllDocumentsWithMetadata();
      
      if (documents.length === 0) {
        console.warn('Service: No documents found to index');
        return;
      }
      
      console.log(`Service: Found ${documents.length} documents, sending to main process...`);
      
      // 2. SEND TO MAIN PROCESS FOR INDEXING
      const result = await window.electronAPI.ai.reindexAll(documents);
      console.log('Service: Reindexing completed:', result);
      
    } catch (error) {
      console.error('Service: Error during reindexing:', error);
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
            // Recupera metadati specifici per il file o documento usando executeQuery
            const metadataRows = await this.dbService.executeQuery<Array<{
              meta_key: string;
              meta_value: string;
            }>>(`
              SELECT meta_key, meta_value
              FROM metadata
              WHERE file_id = ? OR (document_id = (SELECT document_id FROM file WHERE id = ?) AND file_id IS NULL)
            `, [node.fileId, node.fileId]);
            
            const metadataText = metadataRows
              .map((m: any) => `${m.meta_key}: ${m.meta_value}`)
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
    const rows = await this.dbService.executeQuery<Array<{ meta_key: string }>>(`
      SELECT DISTINCT meta_key
      FROM metadata
      WHERE meta_key IS NOT NULL AND meta_key != ''
      ORDER BY meta_key
    `);

    return rows.map(row => row.meta_key);
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
    if (!this.isAiReady) {
      throw new Error('AI model not ready');
    }

    try {
      const response = await window.electronAPI.ai.generateEmbedding(text);
      
      if (Array.isArray(response)) {
        return response;
      } else if (response && response.embedding) {
        return response.embedding;
      }
      
      console.warn('Formato embedding non riconosciuto:', response);
      return [];
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  /**
   * Get AI state (for debugging)
   */
  async getAiState(): Promise<{ initialized: boolean; indexedDocuments: number }> {
    try {
      return await window.electronAPI.ai.state();
    } catch (error) {
      console.error('Error getting AI state:', error);
      return { initialized: false, indexedDocuments: 0 };
    }
  }
}