import { Injectable } from '@angular/core';
import { DatabaseService } from './database-electron.service';
import { IntegrityCheckResult, SavedIntegrityStatus } from '../models/integrity-check';
import { FileService } from './file.service';
import { MetadataService } from './metadata.service';

@Injectable({ providedIn: 'root' })
export class FileIntegrityService {
  constructor(
    private dbService: DatabaseService,
    private fileService: FileService,
    private metadataService: MetadataService
  ) {}

  async verifyFileIntegrity(fileId: number): Promise<IntegrityCheckResult> {
    // Get file path
    const filePath = await this.fileService.getPhysicalPath(fileId);
    if (!filePath) {
      throw new Error('File path not found');
    }

    console.log('[FileIntegrityService] Reading file:', filePath);

    // Read file via IPC
    const fileData = await window.electronAPI.file.read(filePath);
    if (!fileData.success) {
      throw new Error('Failed to read file');
    }

    // Get expected hash from metadata (using MetadataService for consistency)
    const expectedHash = await this.metadataService.getExpectedHash(fileId);
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

  /**
   * Save the verification result to database
   */
  async saveVerificationResult(fileId: number, result: IntegrityCheckResult): Promise<void> {
    console.log(`[FileIntegrityService] Integrity check for file ${fileId}: ${result.isValid ? 'VALID' : 'INVALID'}`);
    console.log(`Expected: ${result.expectedHash}, Calculated: ${result.calculatedHash}`);
    
    const query = 'INSERT INTO file_integrity (file_id, result, algorithm, date_calculated) VALUES (?, ?, ?, ?)';
    await this.dbService.executeQuery(query, [fileId, result.isValid ? 1 : 0, 'SHA-256', new Date().toISOString()]);
  }

  /**
   * Get stored integrity status from database
   */
  async getStoredStatus(fileId: number): Promise<SavedIntegrityStatus | null> {
    const query = `
      SELECT result, algorithm, date_calculated
      FROM file_integrity
      WHERE file_id = ?
    `;
    const rows = await this.dbService.executeQuery<Array<{
      result: number;
      algorithm: string;
      date_calculated: string;
    }>>(query, [fileId]);

    if (rows.length === 0) {
      return null;
    }

    const { result, algorithm, date_calculated } = rows[0];
    
    return {
      result: result === 1,
      algorithm,
      verifiedAt: date_calculated,
    };
  }
}
