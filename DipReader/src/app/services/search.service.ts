import { Injectable } from '@angular/core';
import { DatabaseService } from './database-electron.service';
import { MetadataService } from './metadata.service';
import { SearchFilter, FilterOptionGroup } from '../models/search-filter';

/**
 * Servizio per la gestione della ricerca e filtri
 * 
 * RESPONSIBILITIES:
 * - Semantic search (AI-powered search via embeddings)
 * - Filter management (loading, grouping, applying filters)
 * - Search query coordination (combining semantic + metadata filters)
 * - Document indexing for semantic search
 * - AI model initialization and state management
 * 
 * DEPENDENCIES:
 * - DatabaseService: for executing queries
 * - MetadataService: for metadata retrieval (proper service usage)
 * - Uses Electron IPC for AI operations (main process)
 * 
 * NOTE: This service centralizes ALL search-related logic.
 * Do not duplicate search logic in DatabaseService or other services.
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private isAiReady: boolean = false;
  
  constructor(
    private dbService: DatabaseService,
    private metadataService: MetadataService
  ) {
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
   * Get document details by IDs with formatted metadata
   * Used after semantic search to enrich results with document information
   */
  async getDocumentDetailsByIds(ids: number[]): Promise<any[]> {
    if (!ids || ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');

    // Get document basic info
    const documents = await this.dbService.executeQuery<Array<{
      file_id: number;
      document_id: number;
      file_relative_path: string;
      document_root_path: string;
      aip_uuid: string;
      class_name: string;
    }>>(`
      SELECT 
        f.id as file_id,
        d.id as document_id,
        f.relative_path as file_relative_path,
        d.root_path as document_root_path,
        a.uuid as aip_uuid,
        dc.class_name
      FROM file f
      JOIN document d ON f.document_id = d.id
      JOIN aip a ON d.aip_uuid = a.uuid
      JOIN document_class dc ON a.document_class_id = dc.id
      WHERE f.id IN (${placeholders})
    `, ids);

    // Enrich with metadata using MetadataService (proper service usage)
    const enrichedDocs = await Promise.all(documents.map(async (doc) => {
      // Get all metadata for this file
      const metadataObj = await this.dbService.executeQuery<Array<{
        meta_key: string;
        meta_value: string;
      }>>(`
        SELECT meta_key, meta_value
        FROM metadata
        WHERE file_id = ? OR (document_id = ? AND file_id IS NULL)
      `, [doc.file_id, doc.document_id]);

      // Format metadata as key-value pairs
      const metadata: Record<string, any> = {};
      metadataObj.forEach((m: any) => {
        metadata[m.meta_key] = m.meta_value;
      });

      return {
        fileId: doc.file_id,
        documentId: doc.document_id,
        name: doc.file_relative_path.split('/').pop(),
        type: 'file' as const,
        expanded: false,
        children: [],
        metadata,
        aipUuid: doc.aip_uuid,
        className: doc.class_name
      };
    }));

    return enrichedDocs;
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