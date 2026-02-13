import { Injectable } from '@angular/core';
import { DatabaseService } from './database-electron.service';


@Injectable({ providedIn: 'root' })
export class MetadataService {
  constructor(private dbService: DatabaseService) {}

  /**
   * Get all metadata for a file as a key-value object
   */
  async getMetadata(fileId: number): Promise<any> {
    const attributes = await this.getMetadataAttributes(fileId);
    if (attributes.length === 0) {
      return { error: 'Metadati non trovati nel DB.' };
    }
    // Converte array in oggetto
    return attributes.reduce((acc: Record<string, any>, attr: { key: string; value: string }) => ({ ...acc, [attr.key]: attr.value }), {});
  }

  /**
   * Get a specific metadata value by key
   * Tries file-specific metadata first, then falls back to document-level metadata
   */
  async getMetadataValue(fileId: number, key: string): Promise<string | undefined> {
    // First: try file-specific metadata
    const fileMetadata = await this.dbService.executeQuery<Array<{ meta_value: string }>>(
      `SELECT meta_value FROM metadata WHERE meta_key = ? AND file_id = ?`,
      [key, fileId]
    );
    
    if (fileMetadata?.length > 0) {
      return fileMetadata[0].meta_value;
    }

    // Fallback: try document-level metadata
    const fileRow = await this.dbService.executeQuery<Array<{ document_id: number }>>(
      `SELECT document_id FROM file WHERE id = ?`,
      [fileId]
    );
    
    if (fileRow?.length > 0) {
      const docMetadata = await this.dbService.executeQuery<Array<{ meta_value: string }>>(
        `SELECT meta_value FROM metadata WHERE meta_key = ? AND document_id = ? AND file_id IS NULL`,
        [key, fileRow[0].document_id]
      );
      
      if (docMetadata?.length > 0) {
        return docMetadata[0].meta_value;
      }
    }

    return undefined;
  }

  /**
   * Get expected hash from metadata (Impronta field)
   * This is a convenience method for integrity checking
   */
  async getExpectedHash(fileId: number): Promise<string | null> {
    const hash = await this.getMetadataValue(fileId, 'Impronta');
    return hash || null;
  }

  /**
   * Get metadata attributes for a file
   * First tries file-specific metadata, then falls back to document metadata
   */
  async getMetadataAttributes(fileId: number): Promise<Array<{ key: string; value: string; type: string }>> {
    // First try to get file-specific metadata
    let rows = await this.dbService.executeQuery<Array<{
      meta_key: string;
      meta_value: string;
      meta_type: string;
    }>>(`
      SELECT meta_key, meta_value, meta_type
      FROM metadata
      WHERE file_id = ?
    `, [fileId]);

    // If no file-specific metadata, get document metadata
    if (rows.length === 0) {
      rows = await this.dbService.executeQuery<Array<{
        meta_key: string;
        meta_value: string;
        meta_type: string;
      }>>(`
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
   * Get metadata attributes for a document
   */
  async getDocumentMetadata(documentId: number): Promise<Array<{ key: string; value: string; type: string }>> {
    const rows = await this.dbService.executeQuery<Array<{
      meta_key: string;
      meta_value: string;
      meta_type: string;
    }>>(`
      SELECT meta_key, meta_value, meta_type
      FROM metadata
      WHERE document_id = ? AND file_id IS NULL
      ORDER BY meta_key
    `, [documentId]);

    return rows.map(row => ({
      key: row.meta_key,
      value: row.meta_value,
      type: row.meta_type
    }));
  }

  /**
   * Get document metadata as a typed object with parsed values
   */
  async getDocumentMetadataAsObject(documentId: number): Promise<Record<string, any>> {
    const rows = await this.dbService.executeQuery<Array<{
      meta_key: string;
      meta_value: string;
      meta_type: string;
    }>>(`
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

  /**
   * Get combined text from file metadata for AI indexing
   * Retrieves all metadata and combines it into searchable text
   */
  async getMetadataTextForAI(fileId: number, fileName: string): Promise<string> {
    try {
      // Get all metadata for the file
      const metadataRows = await this.dbService.executeQuery<Array<{
        meta_key: string;
        meta_value: string;
      }>>(`
        SELECT meta_key, meta_value
        FROM metadata
        WHERE file_id = ? OR (document_id = (SELECT document_id FROM file WHERE id = ?) AND file_id IS NULL)
      `, [fileId, fileId]);
      
      const metadataText = metadataRows
        .map((m: any) => `${m.meta_key}: ${m.meta_value}`)
        .join('. ');
      
      // Combine metadata with filename
      const combinedText = (metadataText || '') + ` File: ${fileName}`;
      return combinedText;
      
    } catch (err) {
      console.warn(`[MetadataService] Error getting metadata for file ${fileId}:`, err);
      return fileName; // Fallback to just filename
    }
  }

  /**
   * Utility: Find value by key in a metadata object
   * This is the centralized metadata key lookup - other services should use this
   */
  findValueByKey(metadata: Record<string, any>, key: string): string | null {
    return metadata[key] || null;
  }
}
