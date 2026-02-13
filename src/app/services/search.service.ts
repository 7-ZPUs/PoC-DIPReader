import { Injectable } from '@angular/core';
import { DatabaseService } from './database-electron.service';
import { MetadataService } from './metadata.service';
import { SearchFilter, FilterOptionGroup } from '../models/search-filter';
import '../types/electron-api.types';

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
    
    // Semantic search for textual query
    if (freeTextQuery && freeTextQuery.trim().length > 2) {
      console.log(`Avvio ricerca semantica per: "${freeTextQuery}"`);
      const semanticResults = await this.searchSemantic(freeTextQuery);
      semanticIds = semanticResults.map(r => r.id);
      console.log('Risultati semantici (IDs):', semanticIds);
    }
    
    // Metadata search
    const dbResults = await this.dbService.searchDocuments('', filters as any);
    const filterIds = dbResults
      .filter(node => node.type === 'file' && node.fileId)
      .map(node => node.fileId!);

    // Combine results
    if (semanticIds !== null) {
      if (filters.length > 0) {
        // Intersection: documents matching BOTH criteria
        return semanticIds.filter(id => filterIds.includes(id));
      } else {
        // Only semantic search
        return semanticIds;
      }
    }
    
    // Only metadata search
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

  async getDocumentDetailsByIds(documentIds: number[]): Promise<{documents: any[], idMap: Map<number, number>}> {
    if (!documentIds || documentIds.length === 0) {
      return { documents: [], idMap: new Map() };
    }

    const placeholders = documentIds.map(() => '?').join(',');

    // Get document information directly
    const docs = await this.dbService.executeQuery<Array<{
      document_id: number;
      document_root_path: string;
      aip_uuid: string;
      aip_name: string;
      class_name: string;
    }>>(`
      SELECT 
        d.id as document_id,
        d.root_path as document_root_path,
        a.uuid as aip_uuid,
        a.root_path as aip_name,
        dc.class_name
      FROM document d
      JOIN aip a ON d.aip_uuid = a.uuid
      JOIN document_class dc ON a.document_class_id = dc.id
      WHERE d.id IN (${placeholders})
    `, documentIds);

    // Build document map (1:1 mapping for documents)
    const documentMap = new Map<number, any>();
    const idMap = new Map<number, number>();

    for (const doc of docs) {
      // Track document ID mapping (identity mapping)
      idMap.set(doc.document_id, doc.document_id);

      if (!documentMap.has(doc.document_id)) {
        // Get document-level metadata
        const docMetadata = await this.dbService.executeQuery<Array<{
          meta_key: string;
          meta_value: string;
        }>>(`
          SELECT meta_key, meta_value
          FROM metadata
          WHERE document_id = ? AND file_id IS NULL
        `, [doc.document_id]);

        const metadata: Record<string, any> = {};
        docMetadata.forEach((m: any) => {
          metadata[m.meta_key] = m.meta_value;
        });

        // Create document node (type: 'folder')
        documentMap.set(doc.document_id, {
          fileId: null,
          documentId: doc.document_id,
          name: doc.document_root_path,
          type: 'folder' as const,
          expanded: false,
          children: [],
          metadata,
          aipUuid: doc.aip_uuid,
          aipName: doc.aip_name,
          className: doc.class_name
        });
      }
    }

    return {
      documents: Array.from(documentMap.values()),
      idMap
    };
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