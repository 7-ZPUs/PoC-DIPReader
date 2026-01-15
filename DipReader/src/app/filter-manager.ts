/*FilterManager: Gestisce i filtri globali e flattened sui metadati.*/

export interface Filter {
  key: string;
  value: string;
}

export class FilterManager {
  static flattenMetadata(metadata: any): Map<string, any[]> {
    const flatMap = new Map<string, any[]>();

    const traverse = (obj: any, prefix = '') => {
      if (!obj || typeof obj !== 'object') {
        return;
      }

      if (Array.isArray(obj)) {
        // Per gli array, estrai i valori da ogni elemento
        obj.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            traverse(item, prefix);
          } else {
            const key = prefix || `item_${index}`;
            if (!flatMap.has(key)) {
              flatMap.set(key, []);
            }
            flatMap.get(key)!.push(item);
          }
        });
      } else {
        // Per gli oggetti, naviga in profondità
        Object.keys(obj).forEach((k) => {
          const value = obj[k];
          // Rimuovi il prefisso @ da attributi XML (es: @_isPrimary → isPrimary)
          const cleanKey = k.replace(/^@_/, '');
          const newPrefix = prefix ? `${prefix}.${cleanKey}` : cleanKey;

          if (Array.isArray(value)) {
            // Estrai i valori da ogni elemento dell'array
            value.forEach((item) => {
              if (typeof item === 'object' && item !== null) {
                traverse(item, newPrefix);
              } else {
                if (!flatMap.has(cleanKey)) {
                  flatMap.set(cleanKey, []);
                }
                flatMap.get(cleanKey)!.push(item);
              }
            });
          } else if (typeof value === 'object' && value !== null) {
            traverse(value, newPrefix);
          } else {
            // Valore primitivo: aggiungi sia con chiave completa che semplice
            if (!flatMap.has(cleanKey)) {
              flatMap.set(cleanKey, []);
            }
            flatMap.get(cleanKey)!.push(value);

            // Aggiungi anche con prefisso completo se esiste
            if (newPrefix !== cleanKey && !flatMap.has(newPrefix)) {
              flatMap.set(newPrefix, []);
            }
            if (newPrefix !== cleanKey) {
              flatMap.get(newPrefix)!.push(value);
            }
          }
        });
      }
    };

    traverse(metadata);
    return flatMap;
  }

  static matchesFilters(flatMetadata: Map<string, any[]>, filters: Filter[]): boolean {
    if (filters.length === 0) {
      return true; // Nessun filtro = passa tutto
    }

    // Tutti i filtri devono essere soddisfatti (AND logic)
    return filters.every((filter) => {
      const { key, value } = filter;

      if (!key || !value) {
        return true; // Filtro vuoto non limita
      }

      const values = flatMetadata.get(key);

      if (!values || values.length === 0) {
        return false; // Chiave non trovata = non matcha
      }

      // Almeno un valore deve contenere la stringa di ricerca (case-insensitive)
      return values.some((v) =>
        String(v).toLowerCase().includes(value.toLowerCase())
      );
    });
  }

  static extractAvailableKeys(metadataList: any[]): string[] {
    const keySet = new Set<string>();

    metadataList.forEach((metadata) => {
      const flatMap = this.flattenMetadata(metadata);
      flatMap.forEach((_, key) => {
        keySet.add(key);
      });
    });

    // Ordina le chiavi per miglior UX
    return Array.from(keySet).sort();
  }

  /**
   * Applica i filtri ad un'intera lista di metadati.
   * Restituisce solo i metadati che matchano TUTTI i criteri di filtro.
   */
  static filterMetadataList(metadataList: any[], filters: Filter[]): any[] {
    if (filters.every((f) => !f.key || !f.value)) {
      return metadataList; // Nessun filtro attivo
    }

    return metadataList.filter((metadata) => {
      const flatMetadata = this.flattenMetadata(metadata);
      return this.matchesFilters(flatMetadata, filters);
    });
  }

  /**
   * Estrae il nome significativo da una chiave gerarchica.
   * 
   * Esempio:
   * "Document.DocumentoInformatico.DatiDiRegistrazione.TipoRegistro.Repertorio_Registro.NumeroRegistrazioneDocumento"
   * → "NumeroRegistrazioneDocumento"
   */
  static getSignificantName(fullPath: string): string {
    const parts = fullPath.split('.');
    return parts[parts.length - 1];
  }

  /**
   * Estrae il percorso per il raggruppamento (tutto tranne l'ultimo segment).
   * 
   * Esempio:
   * "Document.DocumentoInformatico.DatiDiRegistrazione.TipoRegistro.Repertorio_Registro.NumeroRegistrazioneDocumento"
   * → "Document.DocumentoInformatico.DatiDiRegistrazione.TipoRegistro.Repertorio_Registro"
   */
  static getGroupPath(fullPath: string): string {
    const parts = fullPath.split('.');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('.');
  }

  /**
   * Estrae il nome del gruppo (ultimo segment del percorso di raggruppamento).
   * 
   * Esempio:
   * "Document.DocumentoInformatico.DatiDiRegistrazione.TipoRegistro.Repertorio_Registro.NumeroRegistrazioneDocumento"
   * → "Repertorio_Registro"
   */
  static getGroupLabel(fullPath: string): string {
    const groupPath = this.getGroupPath(fullPath);
    if (!groupPath) return 'Altro';
    const parts = groupPath.split('.');
    return parts[parts.length - 1];
  }

  /**
   * Organizza le chiavi in un array di gruppi per la visualizzazione in optgroup.
   * 
   * CONSOLIDAMENTO DUPLICATI:
   * Se lo stesso "nome significativo" appare in più sezioni/percorsi,
   * viene consolidato in un'unica opzione. Il valore selezionato è il nome significativo,
   * e la ricerca si applicherà a tutti i fullPath associati.
   * 
   * Esempio:
   * - Document.PF.CodiceFiscale
   * - Document.DatiAllegati.PF.CodiceFiscale
   * → Diventa una sola opzione "CodiceFiscale" nella sezione "PF"
   * 
   * Ritorna un array dove ogni elemento rappresenta un optgroup con le sue opzioni.
   */
  static groupKeysForSelect(
    keys: string[]
  ): { groupLabel: string; groupPath: string; options: Array<{ value: string; label: string }> }[] {
    // Mappa temporanea per consolidare per nome significativo
    // significantName → { groupLabel, groupPath, fullPaths: [] }
    const consolidatedGroups = new Map<
      string,
      {
        significantName: string;
        groupLabel: string;
        groupPath: string;
        fullPaths: string[];
      }
    >();

    keys.forEach((fullPath) => {
      const groupPath = this.getGroupPath(fullPath);
      const groupLabel = this.getGroupLabel(fullPath);
      const significantName = this.getSignificantName(fullPath);

      // Usa il nome significativo come chiave di consolidamento
      const consolidationKey = `${groupLabel}::${significantName}`;

      if (!consolidatedGroups.has(consolidationKey)) {
        consolidatedGroups.set(consolidationKey, {
          significantName,
          groupLabel,
          groupPath,
          fullPaths: []
        });
      }

      // Aggiungi il fullPath alla lista (deduplicate automaticamente con Set se necessario)
      const group = consolidatedGroups.get(consolidationKey)!;
      if (!group.fullPaths.includes(fullPath)) {
        group.fullPaths.push(fullPath);
      }
    });

    // Converte in struttura di optgroup
    const groupsBySection = new Map<
      string,
      { groupLabel: string; groupPath: string; options: Array<{ value: string; label: string }> }
    >();

    consolidatedGroups.forEach((value) => {
      const sectionKey = value.groupPath || 'root';

      if (!groupsBySection.has(sectionKey)) {
        groupsBySection.set(sectionKey, {
          groupPath: value.groupPath,
          groupLabel: value.groupLabel,
          options: []
        });
      }

      groupsBySection.get(sectionKey)!.options.push({
        value: value.significantName, // Usa il nome significativo come valore
        label: value.significantName
      });
    });

    // Converte la Map in array e ordina per nome del gruppo
    return Array.from(groupsBySection.values()).sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));
  }

  /**
   * Crea una mappa di tracciamento per i filtri consolidati.
   * 
   * Mappa: significantName → [fullPath1, fullPath2, ...]
   * 
   * Usata dal database service per espandere i filtri durante la ricerca.
   * Quando l'utente cerca con "CodiceFiscale", la ricerca si applica a:
   * - Document.PF.CodiceFiscale
   * - Document.DatiAllegati.PF.CodiceFiscale
   * - Etc.
   */
  static buildFilterConsolidationMap(keys: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();

    keys.forEach((fullPath) => {
      const significantName = this.getSignificantName(fullPath);

      if (!map.has(significantName)) {
        map.set(significantName, []);
      }

      map.get(significantName)!.push(fullPath);
    });

    return map;
  }
}


