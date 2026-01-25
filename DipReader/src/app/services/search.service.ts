import { Injectable } from '@angular/core';
import { DatabaseService } from '../database.service';
import { SearchFilter, FilterOptionGroup } from '../models/search-filter';

/**
 * Servizio per la gestione della ricerca e filtri
 * Centralizza la logica di ricerca, filtri e grouping delle opzioni
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  constructor(private dbService: DatabaseService) {}

  /**
   * Carica le chiavi disponibili per i filtri da tutti i file
   * @returns Lista di chiavi di metadati disponibili
   */
  async loadAvailableFilterKeys(): Promise<string[]> {
    return await this.dbService.getAvailableMetadataKeys();
  }

  groupFilterKeys(keys: string[]): FilterOptionGroup[] {
    const groups: { [groupLabel: string]: string[] } = {};

    // Raggruppa le chiavi per categoria
    keys.forEach(key => {
      const group = this.extractCategory(key);
      if (!groups[group]) groups[group] = [];
      groups[group].push(key);
    });

    // Converti in formato FilterOptionGroup
    return Object.entries(groups).map(([category, keyList]) => ({
      groupLabel: this.formatCategoryLabel(category),
      groupPath: category,
      options: keyList.map(key => ({
        value: key,
        label: this.formatKeyLabel(key)
      }))
    }));
  }



  async applyFilters(filters: SearchFilter[]): Promise<number[]> {
    if (filters.length === 0) return [];
    // Usa il metodo searchDocuments del database con filtri globali
    const results = await this.dbService.searchDocuments('', filters as any);
    // Restituisce gli ID dei file, filtrando solo i nodi di tipo 'file'
    return results
      .filter(node => node.type === 'file' && node.fileId)
      .map(node => node.fileId!);
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
}
