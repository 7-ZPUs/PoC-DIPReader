import { Injectable } from '@angular/core';
import { DatabaseService } from '../database-electron.service';
import { IntegrityCheckResult, SavedIntegrityStatus } from '../models/integrity-check';

/**
 * Gestione della verifica d'integrità dei file
 * Centralizza la logica di calcolo hash, salvataggio e recupero dello stato
 */
@Injectable({ providedIn: 'root' })
export class FileIntegrityService {
  constructor(private dbService: DatabaseService) {}

  /**
   * Verifica l'integrità completa di un file:
   * - Legge il file dal filesystem
   * - Recupera l'hash atteso dai metadati
   * - Calcola l'hash SHA-256
   * - Confronta e ritorna il risultato
   */
  async verifyFileIntegrity(fileId: number): Promise<IntegrityCheckResult> {
    // Get file path
    const filePath = await this.dbService.getPhysicalPathForFile(fileId);
    if (!filePath) {
      throw new Error('File path not found');
    }

    console.log('[FileIntegrityService] Reading file:', filePath);

    // Read file via IPC
    const fileData = await window.electronAPI.file.read(filePath);
    if (!fileData.success) {
      throw new Error('Failed to read file');
    }

    // Get expected hash from metadata
    const expectedHash = await this.getExpectedHash(fileId);
    if (!expectedHash) {
      throw new Error('Hash not found in metadata');
    }

    // Calculate and compare hash
    const calculatedHash = await this.calculateSHA256(fileData.data);

    return {
      isValid: calculatedHash === expectedHash,
      calculatedHash,
      expectedHash
    };
  }

  /**
   * Recupera l'hash atteso dai metadati del file
   * Cerca prima a livello di file, poi a livello di documento
   */
  private async getExpectedHash(fileId: number): Promise<string | null> {
    // First: look for Impronta associated with this specific file_id
    const fileImprontaResult = await window.electronAPI.db.query(
      `SELECT meta_value FROM metadata WHERE meta_key = 'Impronta' AND file_id = ?`,
      [fileId]
    );
    
    if (fileImprontaResult?.length > 0) {
      return fileImprontaResult[0].meta_value;
    }

    // Fallback: look for document-level Impronta
    const fileRow = await window.electronAPI.db.query(
      `SELECT document_id FROM file WHERE id = ?`, 
      [fileId]
    );
    
    if (fileRow?.length > 0) {
      const docImprontaResult = await window.electronAPI.db.query(
        `SELECT meta_value FROM metadata WHERE meta_key = 'Impronta' AND document_id = ? AND file_id IS NULL`,
        [fileRow[0].document_id]
      );
      
      if (docImprontaResult?.length > 0) {
        return docImprontaResult[0].meta_value;
      }
    }

    return null;
  }

  async verifyFileHash(fileBuffer: ArrayBuffer, expectedHashBase64: string): Promise<IntegrityCheckResult> {
    const calculatedHash = await this.calculateSHA256(fileBuffer);
    
    return {
      isValid: calculatedHash === expectedHashBase64,
      calculatedHash,
      expectedHash: expectedHashBase64
    };
  }

  /**
   * Calculate SHA-256 hash and convert to base64
   * Equivalent to: sha256sum file | cut -d ' ' -f 1 | xxd -r -p | base64
   */
  private async calculateSHA256(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    
    // Convert byte array to binary string, then to base64
    // This is more robust than using spread operator which can fail with large arrays
    let binaryString = '';
    for (let i = 0; i < hashArray.length; i++) {
      binaryString += String.fromCharCode(hashArray[i]);
    }
    
    return btoa(binaryString);
  }

  async saveVerificationResult(fileId: number, result: IntegrityCheckResult): Promise<void> {
    await this.dbService.saveIntegrityStatus(
      fileId,
      result.isValid,
      result.calculatedHash,
      result.expectedHash
    );
  }

  async getStoredStatus(fileId: number): Promise<SavedIntegrityStatus | null> {
    const stored = await this.dbService.getIntegrityStatus(fileId);
    return stored ? {
      result: stored.isValid,
      algorithm: stored.algorithm,
      verifiedAt: stored.date_calculated,
    } : null;
  }
}
