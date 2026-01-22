import { Injectable } from '@angular/core';
import { DatabaseService } from '../database.service';

/**
 * Gestione e manipolazione dei metadati
 * Centralizza accesso, ricerca e elaborazione dei metadati dei file
 */
@Injectable({ providedIn: 'root' })
export class MetadataService {
  constructor(private dbService: DatabaseService) {}

  async getMetadata(logicalPath: string): Promise<any> {
    const attributes = await this.dbService.getMetadataAttributes(logicalPath);
    if (attributes.length === 0) {
      return { error: 'Metadati non trovati nel DB.' };
    }
    // Converte array in oggetto
    return attributes.reduce((acc, attr) => ({ ...acc, [attr.key]: attr.value }), {});
  }

  async getMetadataValue(logicalPath: string, key: string): Promise<string | undefined> {
    const metadata = await this.getMetadata(logicalPath);
    const value = this.dbService.findValueByKey(metadata, key);
    return value || undefined;
  }


  async getExpectedHash(logicalPath: string): Promise<string | null> {
    const hash = await this.getMetadataValue(logicalPath, 'Impronta');
    return hash || null;
  }

  async getMetadataAttributes(logicalPath: string): Promise<Array<{ key: string; value: string }>> {
    return await this.dbService.getMetadataAttributes(logicalPath);
  }
}
