import { Injectable } from '@angular/core';
import { Filter } from './filter-manager';

export interface FileNode {
  name: string;
  type: 'folder' | 'file';
  children: FileNode[];
  expanded?: boolean;
  fileId?: number; // ID del file nel database (solo per nodi di tipo 'file')
  documentId?: number; // ID del documento logico (per nodi documento o file)
}

// Type definitions for the Electron API
declare global {
  interface Window {
    electronAPI: {
      db: {
        init: () => Promise<{ status: string }>;
        open: (dipUUID: string) => Promise<{ success: boolean; dipUUID: string; existed: boolean }>;
        index: (dipUUID: string, dipPath: string) => Promise<{ success: boolean; dipUUID: string }>;
        query: (sql: string, params?: any[]) => Promise<any>;
        list: () => Promise<string[]>;
        delete: (dipUUID: string) => Promise<{ success: boolean }>;
        export: (exportPath?: string) => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
        info: () => Promise<{ open: boolean; dipUUID?: string; fileCount?: number; documentCount?: number }>;
      };
      dip: {
        selectDirectory: () => Promise<{ canceled: boolean; path?: string }>;
      };
      file: {
        read: (filePath: string) => Promise<{ success: boolean; data: ArrayBuffer; mimeType: string }>;
        openExternal: (filePath: string) => Promise<{ success: boolean; error?: string }>;
        openInWindow: (filePath: string) => Promise<{ success: boolean; error?: string }>;
        download: (filePath: string) => Promise<{ success: boolean; canceled?: boolean; savedPath?: string; error?: string }>;
      };
      ai: {
        init: (payload?: any) => Promise<{ status: string }>;
        index: (data: any) => Promise<{ status: string; id: number }>;
        generateEmbedding: (data: any) => Promise<any>;
        search: (data: any) => Promise<any>;
        reindexAll: (data: any) => Promise<{ status: string; indexed: number }>;
        state: () => Promise<{ initialized: boolean; indexedDocuments: number }>;
        clear: () => Promise<{ status: string }>;
      };
      utils: {
        showMessage: (message: string, type?: 'info' | 'error' | 'warning') => Promise<boolean>;
      };
    };
  }
}

/**
 * Service for managing SQLite database via Electron IPC
 * Communicates with the main process for all database operations
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private dbReady = false;
  private currentDipUUID: string | null = null;
  private currentDipPath: string | null = null;
  private availableDips: string[] = [];

  constructor() {
    this.initDatabase();
  }

  /**
   * Initialize the database connection
   */
  private async initDatabase(): Promise<void> {
    try {
      const result = await window.electronAPI.db.init();
      console.log('[DatabaseService] Database ready:', result);
      try {
          const aiResult = await window.electronAPI.ai.init();
          console.log('[DatabaseService] AI ready:', aiResult);
      } catch (aiError) {
          console.warn('[DatabaseService] AI init warning (potrebbe essere in background):', aiError);
      }
      this.dbReady = true;
      // Load available databases
      await this.loadAvailableDips();
    } catch (error) {
      console.error('[DatabaseService] Database initialization error:', error);
    }
  }

  /**
   * Start indexing a DIP directory
   */
  async indexDirectory(): Promise<void> {
    console.log('[DatabaseService] Selecting directory...');
    
    const result = await window.electronAPI.dip.selectDirectory();
    
    if (result.canceled || !result.path) {
      throw new Error('Directory selection canceled');
    }

    const dipPath = result.path;
    console.log('[DatabaseService] Selected path:', dipPath);

    // Extract DIP UUID from directory or DiPIndex file
    const dipUUID = await this.extractDipUUID(dipPath);
    
    if (!dipUUID) {
      throw new Error('Unable to extract DIP UUID from the selected directory');
    }

    console.log('[DatabaseService] DIP UUID:', dipUUID);
    this.currentDipPath = dipPath;

    // Open or create database and index
    const indexResult = await window.electronAPI.db.index(dipUUID, dipPath);
    
    if (indexResult.success) {
      this.currentDipUUID = indexResult.dipUUID;
      await this.loadAvailableDips();
      console.log('[DatabaseService] Indexing completed for:', indexResult.dipUUID);
    } else {
      throw new Error('Indexing failed');
    }
  }

  /**
   * Extract DIP UUID from the directory path or DiPIndex file
   */
  private async extractDipUUID(dipPath: string): Promise<string | null> {
    // The UUID extraction will happen in the main process
    // For now, we'll use a simple extraction from path or generate one
    const pathParts = dipPath.split(/[/\\]/);
    const lastPart = pathParts[pathParts.length - 1];
    
    // Try to extract UUID from directory name
    const uuidMatch = lastPart.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    
    if (uuidMatch) {
      return uuidMatch[0];
    }

    // If no UUID in path, use the directory name as UUID (sanitized)
    return lastPart.replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  /**
   * Execute a SQL query on the database
   * This is the main method for all services to interact with the database
   */
  async executeQuery<T = any>(sql: string, params: any[] = []): Promise<T> {
    if (!this.dbReady) {
      throw new Error('Database not ready yet');
    }

    try {
      const result = await window.electronAPI.db.query(sql, params);
      return result as T;
    } catch (error) {
      console.error('[DatabaseService] Query error:', error);
      throw error;
    }
  }

  /**
   * Check if database is ready for queries
   */
  isDbReady(): boolean {
    return this.dbReady && this.currentDipUUID !== null;
  }

  /**
   * Get current DIP UUID
   */
  getCurrentDipUUID(): string | null {
    return this.currentDipUUID;
  }

  /**
   * Get current DIP path
   */
  getCurrentDipPath(): string | null {
    return this.currentDipPath;
  }

  /**
   * Get list of available DIPs
   */
  getAvailableDips(): string[] {
    return [...this.availableDips];
  }

  /**
   * Load list of available databases
   */
  private async loadAvailableDips(): Promise<void> {
    try {
      this.availableDips = await window.electronAPI.db.list();
      console.log('[DatabaseService] Available databases:', this.availableDips);
    } catch (error) {
      console.error('[DatabaseService] Error loading available DIPs:', error);
    }
  }

  /**
   * Switch active database
   */
  async switchDatabase(dipUUID: string): Promise<void> {
    try {
      await window.electronAPI.db.open(dipUUID);
      this.currentDipUUID = dipUUID;
      console.log('[DatabaseService] Switched to database:', dipUUID);
    } catch (error) {
      console.error('[DatabaseService] Error switching database:', error);
      throw error;
    }
  }

  /**
   * Delete a DIP database
   */
  async deleteDatabase(dipUUID: string): Promise<boolean> {
    try {
      const result = await window.electronAPI.db.delete(dipUUID);
      
      if (result.success) {
        if (this.currentDipUUID === dipUUID) {
          this.currentDipUUID = null;
          this.currentDipPath = null;
        }
        await this.loadAvailableDips();
      }
      
      return result.success;
    } catch (error) {
      console.error('[DatabaseService] Error deleting database:', error);
      return false;
    }
  }

  /**
   * Export current database
   */
  async exportDatabase(): Promise<boolean> {
    try {
      const result = await window.electronAPI.db.export();
      return result.success && !result.canceled;
    } catch (error) {
      console.error('[DatabaseService] Error exporting database:', error);
      return false;
    }
  }

  /**
   * Get database info
   */
  async getDatabaseInfo(): Promise<{ open: boolean; dipUUID?: string; fileCount?: number; documentCount?: number }> {
    try {
      return await window.electronAPI.db.info();
    } catch (error) {
      console.error('[DatabaseService] Error getting database info:', error);
      return { open: false };
    }
  }

  async getTreeFromDb(): Promise<FileNode[]> {
    // Query that retrieves the complete hierarchy: DocumentClass -> AiP -> Document -> File
    const rows = await this.executeQuery<{
      class_id: number;
      class_name: string;
      aip_uuid: string;
      document_id: number;
      document_root_path: string;
      file_id: number;
      file_relative_path: string;
    }[]>(`
      SELECT 
        dc.id as class_id,
        dc.class_name,
        a.uuid as aip_uuid,
        d.id as document_id,
        d.root_path as document_root_path,
        f.id as file_id,
        f.relative_path as file_relative_path
      FROM document_class dc
      LEFT JOIN aip a ON a.document_class_id = dc.id
      LEFT JOIN document d ON d.aip_uuid = a.uuid
      LEFT JOIN file f ON f.document_id = d.id
      ORDER BY dc.class_name, a.uuid, d.id, f.id
    `);

    // Build tree structure
    const classMap = new Map<number, FileNode>();
    const aipMap = new Map<string, FileNode>();
    const docMap = new Map<number, FileNode>();

    for (const row of rows) {
      // Create or get DocumentClass node (as folder)
      if (!classMap.has(row.class_id)) {
        classMap.set(row.class_id, {
          name: row.class_name,
          type: 'folder',
          children: []
        });
      }
      const classNode = classMap.get(row.class_id)!;

      // Create or get AiP node (as folder)
      if (row.aip_uuid && !aipMap.has(row.aip_uuid)) {
        const aipNode: FileNode = {
          name: `AiP: ${row.aip_uuid}`,
          type: 'folder',
          children: []
        };
        aipMap.set(row.aip_uuid, aipNode);
        classNode.children!.push(aipNode);
      }

      if (row.aip_uuid && row.document_id) {
        const aipNode = aipMap.get(row.aip_uuid)!;

        // Create or get Document node (as folder)
        if (!docMap.has(row.document_id)) {
          const docNode: FileNode = {
            name: `Document: ${row.document_root_path}`,
            type: 'folder',
            documentId: row.document_id,  // Add documentId here!
            children: []
          };
          docMap.set(row.document_id, docNode);
          aipNode.children!.push(docNode);
        }

        if (row.file_id) {
          const docNode = docMap.get(row.document_id)!;
          // Add file node
          docNode.children!.push({
            name: row.file_relative_path,
            type: 'file',
            fileId: row.file_id,
            children: []
          });
        }
      }
    }

    return Array.from(classMap.values());
  }

  /**
   * Get available metadata keys for filters
   * Maintained for backward compatibility - consider moving to SearchService
   */
  async getAvailableMetadataKeys(): Promise<string[]> {
    const rows = await this.executeQuery<{ meta_key: string }[]>(`
      SELECT DISTINCT meta_key
      FROM metadata
      WHERE meta_key IS NOT NULL AND meta_key != ''
      ORDER BY meta_key
    `);

    return rows.map(row => row.meta_key);
  }

  /**
   * Search documents by name and filters
   * Core method for building the filtered tree structure
   */
  async searchDocuments(searchName: string, filters: Filter[]): Promise<FileNode[]> {
    let sql = `
      SELECT DISTINCT
        f.id as file_id,
        f.relative_path as file_path,
        f.document_id,
        f.is_main,
        d.root_path as document_path
      FROM file f
      JOIN document d ON d.id = f.document_id
    `;

    const params: any[] = [];
    const whereClauses: string[] = [];

    // Search by file name
    if (searchName && searchName.trim()) {
      whereClauses.push(`f.relative_path LIKE ?`);
      params.push(`%${searchName.trim()}%`);
    }

    // Apply metadata filters
    if (filters && filters.length > 0) {
      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];
        if (filter.key && filter.value) {
          sql += ` JOIN metadata m${i} ON m${i}.document_id = d.id`;
          whereClauses.push(`(m${i}.meta_key = ? AND m${i}.meta_value LIKE ?)`);
          params.push(filter.key, `%${filter.value}%`);
        }
      }
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ` + whereClauses.join(' AND ');
    }

    sql += ` ORDER BY d.id, f.is_main DESC, f.relative_path`;

    const rows = await this.executeQuery<{
      file_id: number;
      file_path: string;
      document_id: number;
      is_main: number;
      document_path: string;
    }[]>(sql, params);

    // Convert to FileNode array
     const documentMap = new Map<number, FileNode>();
    
    for (const row of rows) {
      if (!documentMap.has(row.document_id)) {
        // Create document node
        documentMap.set(row.document_id, {
          name: `Documento: ${row.document_path || row.document_id}`,
          type: 'folder',
          documentId: row.document_id,
          expanded: false,
          children: []
        });
      }
      
      const docNode = documentMap.get(row.document_id)!;
      const fileName = row.file_path.split('/').pop() || row.file_path;
      
      // Add file node to document
      docNode.children.push({
        name: `${row.is_main ? '📄 ' : '📎 '}${fileName}`,
        type: 'file',
        fileId: row.file_id,
        documentId: row.document_id,
        children: []
      });
    }

    return Array.from(documentMap.values());
  }

  async searchSemantic(queryText: string): Promise<any[]> {
    if (!queryText || queryText.trim() === '') return [];

    console.log('[DatabaseService] Avvio ricerca semantica:', queryText);

    try {
      const response = await window.electronAPI.ai.search({ 
        query: queryText,
        requestId: Date.now()
      });
      
      let results = [];
      if (Array.isArray(response)) {
          results = response; // Caso legacy
      } else if (response && response.results) {
          results = response.results; // Caso nuovo protocollo
      }

      console.log('[DatabaseService] Risultati AI:', results);

      if (results.length > 0) {
        const docIds = results.map((r: any) => r.id);
        return results;
      }
      
      return [];

    } catch (error) {
      console.error('[DatabaseService] Errore ricerca semantica:', error);
      throw error; // Rilancia per gestire l'errore nella UI
    }
  }



  
  async getFilesByIds(ids: number[]): Promise<any[]> {
  if (!ids || ids.length === 0) return [];

  // Costruisci la query SQL dinamica per recuperare solo i file trovati
  const placeholders = ids.map(() => '?').join(',');
  const sql = `SELECT id, relative_path FROM file WHERE id IN (${placeholders})`;

  // Esegui la query
  const rows = await this.executeQuery(sql, ids);

  // Mappa i risultati nel formato FileNode
  return rows.map((row: any) => ({
    fileId: row.id,
    name: row.relative_path.split('/').pop(), // Estrae solo il nome file dal percorso
    type: 'file',
    expanded: false,
    children: []
  }));
}
 
  findValueByKey(metadata: Record<string, any>, key: string): string | null {
    return metadata[key] || null;
  }
}