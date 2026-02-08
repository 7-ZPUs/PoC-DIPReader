import { Injectable } from '@angular/core';
import { FileNode } from './dip-reader.service';
import { Filter } from './filter-manager';

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
   */
  private async executeQuery<T = any>(sql: string, params: any[] = []): Promise<T> {
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

  async getDocumentMetadata(documentId: number): Promise<Record<string, any>> {
    const rows = await this.executeQuery<{
      meta_key: string;
      meta_value: string;
      meta_type: string;
    }[]>(`
      SELECT meta_key, meta_value, meta_type
      FROM metadata
      WHERE document_id = ?
    `, [documentId]);

    const metadata: Record<string, any> = {};

    for (const row of rows) {
      let value: any = row.meta_value;
      
      // Convert based on meta_type
      if (row.meta_type === 'number') {
        value = parseFloat(row.meta_value);
      } else if (row.meta_type === 'boolean') {
        value = row.meta_value === 'true' || row.meta_value === '1';
      }

      metadata[row.meta_key] = value;
    }

    return metadata;
  }

  async getFileMetadata(fileId: number): Promise<Record<string, any>> {
    const rows = await this.executeQuery<{
      meta_key: string;
      meta_value: string;
      meta_type: string;
    }[]>(`
      SELECT meta_key, meta_value, meta_type
      FROM metadata
      WHERE file_id = ?
    `, [fileId]);

    const metadata: Record<string, any> = {};

    for (const row of rows) {
      let value: any = row.meta_value;
      
      if (row.meta_type === 'number') {
        value = parseFloat(row.meta_value);
      } else if (row.meta_type === 'boolean') {
        value = row.meta_value === 'true' || row.meta_value === '1';
      }

      metadata[row.meta_key] = value;
    }

    return metadata;
  }

  /**
   * Read file content from the file system
   */
  async readFile(filePath: string): Promise<{ data: ArrayBuffer; mimeType: string }> {
    try {
      const result = await window.electronAPI.file.read(filePath);
      return { data: result.data, mimeType: result.mimeType };
    } catch (error) {
      console.error('[DatabaseService] Error reading file:', error);
      throw error;
    }
  }

  /**
   * Get full file path for a file ID
   */
  async getFilePath(fileId: number): Promise<string | null> {
    const rows = await this.executeQuery<{
      root_path: string;
    }[]>(`
      SELECT root_path
      FROM file
      WHERE id = ?
    `, [fileId]);

    if (rows.length === 0) {
      return null;
    }

    return rows[0].root_path;
  }

  /**
   * Get document subjects
   */
  async getDocumentSubjects(documentId: number): Promise<any[]> {
    const rows = await this.executeQuery<any[]>(`
      SELECT 
        dsa.role,
        s.id as subject_id,
        pf.first_name as pf_first_name,
        pf.last_name as pf_last_name,
        pf.cf as pf_cf,
        pg.denomination as pg_denomination,
        pg.piva as pg_piva
      FROM document_subject_association dsa
      JOIN subject s ON s.id = dsa.subject_id
      LEFT JOIN subject_pf pf ON pf.subject_id = s.id
      LEFT JOIN subject_pg pg ON pg.subject_id = s.id
      WHERE dsa.document_id = ?
    `, [documentId]);

    return rows;
  }

  /**
   * Get administrative procedures for a document
   */
  async getDocumentProcedures(documentId: number): Promise<any[]> {
    const rows = await this.executeQuery<any[]>(`
      SELECT 
        ap.catalog_uri,
        ap.title,
        ap.subject_of_interest,
        p.phase_type,
        p.start_date,
        p.end_date
      FROM document d
      LEFT JOIN administrative_procedure ap ON ap.id IN (
        SELECT procedure_id FROM phase WHERE procedure_id = ap.id
      )
      LEFT JOIN phase p ON p.procedure_id = ap.id
      WHERE d.id = ?
    `, [documentId]);

    return rows;
  }

  /**
   * Get available metadata keys for filters
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
   * Get grouped filter keys organized by category
   */
  async getGroupedFilterKeys(): Promise<Array<{
    groupLabel: string;
    groupPath: string;
    options: Array<{ value: string; label: string }>;
  }>> {
    const keys = await this.getAvailableMetadataKeys();
    
    // Group keys by common prefixes or categories
    const groups: Map<string, string[]> = new Map();
    
    for (const key of keys) {
      // Simple grouping logic - you can customize this
      let group = 'General';
      
      if (key.includes('Data') || key.includes('Date')) {
        group = 'Date Fields';
      } else if (key.includes('Codice') || key.includes('Id')) {
        group = 'Identifiers';
      } else if (key.includes('Nome') || key.includes('Denominazione')) {
        group = 'Names';
      } else if (key.includes('Indirizzo') || key.includes('Sede')) {
        group = 'Addresses';
      }
      
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(key);
    }
    
    // Convert to the expected format
    const result: Array<{
      groupLabel: string;
      groupPath: string;
      options: Array<{ value: string; label: string }>;
    }> = [];
    
    for (const [groupLabel, keys] of groups.entries()) {
      result.push({
        groupLabel,
        groupPath: groupLabel.toLowerCase().replace(/\s+/g, '-'),
        options: keys.map(key => ({ value: key, label: key }))
      });
    }
    
    return result;
  }

  /**
   * Search documents by name and filters
   */
  async searchDocuments(searchName: string, filters: Filter[]): Promise<FileNode[]> {
    let sql = `
      SELECT DISTINCT
        f.id as file_id,
        f.relative_path as file_path,
        f.document_id,
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

    sql += ` ORDER BY f.relative_path`;

    const rows = await this.executeQuery<{
      file_id: number;
      file_path: string;
      document_id: number;
      document_path: string;
    }[]>(sql, params);

    // Convert to FileNode array
    return rows.map(row => ({
      name: row.file_path,
      type: 'file' as const,
      fileId: row.file_id,
      children: []
    }));
  }

  /**
   * Get metadata attributes for a file
   */
  async getMetadataAttributes(fileId: number): Promise<Array<{ key: string; value: string; type: string }>> {
    // First try to get file-specific metadata
    let rows = await this.executeQuery<{
      meta_key: string;
      meta_value: string;
      meta_type: string;
    }[]>(`
      SELECT meta_key, meta_value, meta_type
      FROM metadata
      WHERE file_id = ?
    `, [fileId]);

    // If no file-specific metadata, get document metadata
    if (rows.length === 0) {
      rows = await this.executeQuery<{
        meta_key: string;
        meta_value: string;
        meta_type: string;
      }[]>(`
        SELECT m.meta_key, m.meta_value, m.meta_type
        FROM metadata m
        JOIN file f ON f.document_id = m.document_id
        WHERE f.id = ? AND m.document_id IS NOT NULL
      `, [fileId]);
    }

    return rows.map(row => ({
      key: row.meta_key,
      value: row.meta_value,
      type: row.meta_type
    }));
  }

  /**
   * Get physical path for a file from database
   */
  async getPhysicalPathFromDb(fileId: number): Promise<string | undefined> {
    const rows = await this.executeQuery<{
      root_path: string;
    }[]>(`
      SELECT root_path
      FROM file
      WHERE id = ?
    `, [fileId]);

    if (rows.length === 0) {
      return undefined;
    }

    // Build the full path combining DIP root and file path
    const filePath = rows[0].root_path;
    
    if (!this.currentDipPath) {
      console.warn('Current DIP path not set, returning relative path');
      return filePath;
    }

    // Combine paths
    return `${this.currentDipPath}/${filePath}`;
  }

  /**
   * Get integrity status for a file
   */
  async getIntegrityStatus(fileId: number): Promise<{
    isValid: boolean;
    calculatedHash: string;
    expectedHash: string;
    verifiedAt: string;
  } | null> {
    // For now, we don't have a separate integrity table
    // Return null to indicate no cached integrity check
    // This can be implemented later with a dedicated table
    return null;
  }

  /**
   * Save integrity status for a file
   */
  async saveIntegrityStatus(
    fileId: number,
    isValid: boolean,
    calculatedHash: string,
    expectedHash: string
  ): Promise<void> {
    // This could be implemented with a dedicated integrity_check table
    // For now, we'll just log it
    console.log(`[DatabaseService] Integrity check for file ${fileId}: ${isValid ? 'VALID' : 'INVALID'}`);
    console.log(`Expected: ${expectedHash}, Calculated: ${calculatedHash}`);
    
    // TODO: Implement persistent storage of integrity checks
    // CREATE TABLE IF NOT EXISTS integrity_check (
    //   file_id INTEGER PRIMARY KEY,
    //   is_valid BOOLEAN,
    //   calculated_hash TEXT,
    //   expected_hash TEXT,
    //   verified_at TEXT,
    //   FOREIGN KEY (file_id) REFERENCES file(id)
    // );
  }

  /**
   * Find value by key in a metadata object
   */
  findValueByKey(metadata: Record<string, any>, key: string): string | null {
    return metadata[key] || null;
  }
}


