import { Injectable } from '@angular/core';
import { DatabaseService } from '../database.service';

/**
 * Gestione e manipolazione dei metadati
 * Centralizza accesso, ricerca e elaborazione dei metadati dei file
 */
@Injectable({ providedIn: 'root' })
export class MetadataService {
  constructor(private dbService: DatabaseService) {}

  async getMetadata(fileId: number): Promise<any> {
    const attributes = await this.dbService.getMetadataAttributes(fileId);
    if (attributes.length === 0) {
      return { error: 'Metadati non trovati nel DB.' };
    }
    // Converte array in oggetto
    return attributes.reduce((acc, attr) => ({ ...acc, [attr.key]: attr.value }), {});
  }

  async getMetadataValue(fileId: number, key: string): Promise<string | undefined> {
    const metadata = await this.getMetadata(fileId);
    const value = this.dbService.findValueByKey(metadata, key);
    return value || undefined;
  }


  async getExpectedHash(fileId: number): Promise<string | null> {
    const hash = await this.getMetadataValue(fileId, 'Impronta');
    return hash || null;
  }

  async getMetadataAttributes(fileId: number): Promise<Array<{ key: string; value: string }>> {
    return await this.dbService.getMetadataAttributes(fileId);
  }
}
