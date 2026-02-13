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
        // Extract values from each array element
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
        // For objects, navigate deeply
        Object.keys(obj).forEach((k) => {
          const value = obj[k];
          // Remove the @ prefix from XML attributes (e.g., @_isPrimary → isPrimary)
          const cleanKey = k.replace(/^@_/, '');
          const newPrefix = prefix ? `${prefix}.${cleanKey}` : cleanKey;

          if (Array.isArray(value)) {
            // Extract values from each array element
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
            // Primitive value, add to map
            if (!flatMap.has(cleanKey)) {
              flatMap.set(cleanKey, []);
            }
            flatMap.get(cleanKey)!.push(value);

            // Also add with full prefix if it exists
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
      return true; // No filters = pass all
    }

    // All filters must be satisfied (AND logic)
    return filters.every((filter) => {
      const { key, value } = filter;

      if (!key || !value) {
        return true; // Empty filter does not restrict
      }

      const values = flatMetadata.get(key);

      if (!values || values.length === 0) {
        return false; // Key not found = does not match
      }

      // At least one value must contain the search string (case-insensitive)
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

    // Sort keys for better UX
    return Array.from(keySet).sort();
  }

  static filterMetadataList(metadataList: any[], filters: Filter[]): any[] {
    if (filters.every((f) => !f.key || !f.value)) {
      return metadataList; // No active filters
    }

    return metadataList.filter((metadata) => {
      const flatMetadata = this.flattenMetadata(metadata);
      return this.matchesFilters(flatMetadata, filters);
    });
  }

  static getSignificantName(fullPath: string): string {
    const parts = fullPath.split('.');
    return parts[parts.length - 1];
  }

  /**
   * Extracts the path for grouping (everything except the last segment).
   * 
   * Example:
   * "Document.DocumentoInformatico.DatiDiRegistrazione.TipoRegistro.Repertorio_Registro.NumeroRegistrazioneDocumento"
   * → "Document.DocumentoInformatico.DatiDiRegistrazione.TipoRegistro.Repertorio_Registro"
   */
  static getGroupPath(fullPath: string): string {
    const parts = fullPath.split('.');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('.');
  }

  /**
   * Extracts the group name (last segment of the grouping path).
   * 
   * Example:
   * "Document.DocumentoInformatico.DatiDiRegistrazione.TipoRegistro.Repertorio_Registro.NumeroRegistrazioneDocumento"
   * → "Repertorio_Registro"
   */
  static getGroupLabel(fullPath: string): string {
    const groupPath = this.getGroupPath(fullPath);
    if (!groupPath) return 'Other';
    const parts = groupPath.split('.');
    return parts[parts.length - 1];
  }

  static groupKeysForSelect(
    keys: string[]
  ): { groupLabel: string; groupPath: string; options: Array<{ value: string; label: string }> }[] {
    // Temporary map to consolidate by significant name
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

      // Use the significant name as the consolidation key
      const consolidationKey = `${groupLabel}::${significantName}`;

      if (!consolidatedGroups.has(consolidationKey)) {
        consolidatedGroups.set(consolidationKey, {
          significantName,
          groupLabel,
          groupPath,
          fullPaths: []
        });
      }

      // Add the fullPath to the list (deduplicate automatically with Set if necessary)
      const group = consolidatedGroups.get(consolidationKey)!;
      if (!group.fullPaths.includes(fullPath)) {
        group.fullPaths.push(fullPath);
      }
    });

    // Convert to optgroup structure
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

    // Convert the Map to an array and sort by group name
    return Array.from(groupsBySection.values()).sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));
  }

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


