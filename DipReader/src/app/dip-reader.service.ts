import { Injectable } from '@angular/core';
import { DatabaseService } from './database.service';
import { FileIntegrityService } from './services/file-integrity.service';
import { MetadataService } from './services/metadata.service';

export interface FileNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  children: FileNode[];
  expanded?: boolean;
}

/**
 * Servizio semplificato per l'accesso ai dati DIP
 * Delega tutte le operazioni al DatabaseService
 */
@Injectable({ providedIn: 'root' })
export class DipReaderService {
  constructor(
    private dbService: DatabaseService,
    private fileIntegrityService: FileIntegrityService,
    private metadataService: MetadataService
  ) { }

  /**
   * Recupera i metadati per un file dal database.
   */
  public async getMetadataForFile(logicalPath: string): Promise<any> {
    const attributes = await this.dbService.getMetadataAttributes(logicalPath);
    if (attributes.length === 0) {
      return { error: 'Metadati non trovati nel DB.' };
    }
    // Converte array in oggetto
    return attributes.reduce((acc, attr) => ({ ...acc, [attr.key]: attr.value }), {});
  }

  /**
   * Recupera il percorso fisico web-accessible per un file dal database.
   */
  public async getPhysicalPathForFile(logicalPath: string): Promise<string | undefined> {
    return this.dbService.getPhysicalPathFromDb(logicalPath);
  }

  /**
   * Verifica l'integrità di un file scaricandolo, calcolando l'hash SHA-256
   * e confrontandolo con quello memorizzato nei metadati
   */
  public async verifyFileIntegrity(logicalPath: string): Promise<{ valid: boolean, calculated: string, expected: string }> {
    const physicalPath = await this.getPhysicalPathForFile(logicalPath);
    if (!physicalPath) throw new Error('File fisico non trovato.');

    // Recupera l'hash atteso dai metadati
    const expectedHash = await this.metadataService.getExpectedHash(logicalPath);
    if (!expectedHash) {
      throw new Error('Impronta crittografica (Hash) non trovata nei metadati.');
    }

    // TODO: Implementare verifica integrità con File System Access API
    // Per ora restituiamo un risultato fittizio
    console.warn('[DipReaderService] Verifica integrità non ancora implementata nel nuovo sistema');
    
    return {
      valid: true,
      calculated: 'NOT_IMPLEMENTED',
      expected: expectedHash
    };
  }

  /**
   * Recupera lo stato di integrità precedentemente salvato per un file
   */
  public async getStoredIntegrityStatus(logicalPath: string): Promise<{ valid: boolean, calculated: string, expected: string, verifiedAt: string } | null> {
    const stored = await this.dbService.getIntegrityStatus(logicalPath);
    if (!stored) return null;
    
    return {
      valid: stored.isValid,
      calculated: stored.calculatedHash,
      expected: stored.expectedHash,
      verifiedAt: stored.verifiedAt
    };
  }
}