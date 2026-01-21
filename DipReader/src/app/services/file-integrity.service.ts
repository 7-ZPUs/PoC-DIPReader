import { Injectable } from '@angular/core';
import { DatabaseService } from '../database.service';
import { IntegrityCheckResult, SavedIntegrityStatus } from '../models/integrity-check';

/**
 * Gestione della verifica d'integrità dei file
 * Centralizza la logica di calcolo hash, salvataggio e recupero dello stato
 */
@Injectable({ providedIn: 'root' })
export class FileIntegrityService {
  constructor(private dbService: DatabaseService) {}

  async verifyFileHash(fileBuffer: ArrayBuffer, expectedHashBase64: string): Promise<IntegrityCheckResult> {
    const calculatedHash = await this.calculateSHA256(fileBuffer);
    
    return {
      isValid: calculatedHash === expectedHashBase64,
      calculatedHash,
      expectedHash: expectedHashBase64
    };
  }

  private async calculateSHA256(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return btoa(String.fromCharCode(...hashArray));
  }

  async saveVerificationResult(logicalPath: string, result: IntegrityCheckResult): Promise<void> {
    await this.dbService.saveIntegrityStatus(
      logicalPath,
      result.isValid,
      result.calculatedHash,
      result.expectedHash
    );
  }

  async getStoredStatus(logicalPath: string): Promise<SavedIntegrityStatus | null> {
    const stored = await this.dbService.getIntegrityStatus(logicalPath);
    return stored ? {
      isValid: stored.isValid,
      calculatedHash: stored.calculatedHash,
      expectedHash: stored.expectedHash,
      verifiedAt: stored.verifiedAt
    } : null;
  }
}
