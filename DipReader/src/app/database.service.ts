import { Injectable } from '@angular/core';
// Importiamo SOLO il tipo per TypeScript, così Vite non tocca il pacchetto a runtime
import type sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { FileNode } from './dip-reader.service';
import { FilterManager, Filter } from './filter-manager';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type DB = InstanceType<Sqlite3['oo1']['DB']>;

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private db: DB | null = null;
  private sqlite3: Sqlite3 | null = null;
  private dbReady = false;

  constructor() {}

  async initializeDb(): Promise<void> {
    return;
    // if (this.dbReady) return;

    // try {
    //   console.log('Inizializzazione database SQLite...');
      
    //   // Caricamento dinamico del modulo JS dalla cartella public
    //   // Questo bypassa il bundling di Vite e carica i file statici che abbiamo copiato
    //   // @ts-ignore
    //   const sqliteJsPath = '/sqlite3.mjs';
    //   const module = await import(/* @vite-ignore */ sqliteJsPath);
    //   const initFunc = module.default as typeof sqlite3InitModule;

    //   const sqlite3: Sqlite3 = await initFunc({
    //     print: console.log,
    //     printErr: console.error,
    //     // locateFile ora funzionerà sicuramente perché il JS è nella stessa cartella del WASM (root)
    //     locateFile: (file: string) => {
    //       console.log(`[SQLite] locateFile richiesto per: ${file}`);
    //       // Usa endsWith per intercettare anche './sqlite3.wasm' o altri percorsi relativi
    //       if (file.endsWith('sqlite3.wasm')) {
    //         const wasmPath = '/sqlite3.wasm';
    //         console.log(`[SQLite] Reindirizzamento WASM a: ${wasmPath}`);
    //         return wasmPath;
    //       }
    //       return file;
    //     }
    //   });
    //   const oo = sqlite3.oo1;
    //   this.sqlite3 = sqlite3;
    //   this.db = new oo.DB('/dip.sqlite3', 'ct'); // 'c'reate, 't'race
    //   console.log('Database aperto:', this.db.filename);

    //   // Creazione tabelle ottimizzate per indicizzazione e ricerca
    //   this.db.exec(`
    //     -- Configurazione generale
    //     CREATE TABLE IF NOT EXISTS config (
    //       key TEXT PRIMARY KEY,
    //       value TEXT
    //     );
        
    //     -- Tabella nodi: struttura gerarchica del pacchetto
    //     CREATE TABLE IF NOT EXISTS nodes (
    //       logical_path TEXT PRIMARY KEY,
    //       parent_path TEXT,
    //       name TEXT NOT NULL,
    //       type TEXT NOT NULL
    //     );
        
    //     -- Metadati grezzi (JSON) per visualizzazione completa
    //     CREATE TABLE IF NOT EXISTS raw_metadata (
    //       logical_path TEXT PRIMARY KEY,
    //       data TEXT,
    //       FOREIGN KEY(logical_path) REFERENCES nodes(logical_path) ON DELETE CASCADE
    //     );
        
    //     -- Metadati indicizzati (Key-Value) per ricerca rapida
    //     CREATE TABLE IF NOT EXISTS metadata_attributes (
    //       id INTEGER PRIMARY KEY AUTOINCREMENT,
    //       logical_path TEXT NOT NULL,
    //       key TEXT NOT NULL,
    //       value TEXT,
    //       FOREIGN KEY(logical_path) REFERENCES nodes(logical_path) ON DELETE CASCADE
    //     );
        
    //     -- Mappatura percorsi fisici
    //     CREATE TABLE IF NOT EXISTS physical_paths (
    //       logical_path TEXT PRIMARY KEY,
    //       physical_path TEXT,
    //       FOREIGN KEY(logical_path) REFERENCES nodes(logical_path) ON DELETE CASCADE
    //     );

    //     -- Indici per performance
    //     CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_path);
    //     CREATE INDEX IF NOT EXISTS idx_meta_attr_key ON metadata_attributes(key);
    //     CREATE INDEX IF NOT EXISTS idx_meta_attr_val ON metadata_attributes(value);
    //   `);
    //   this.dbReady = true;
    //   console.log('Tabelle SQLite create/verificate (Nuova Struttura).');
    // } catch (err: any) {
    //   console.error('Errore durante inizializzazione DB:', err.message);
    // }
  }

  async isPopulated(indexFileName: string): Promise<boolean> {
    const db = this.db;
    if (!db) return false;
    const result = db.selectValue('SELECT value FROM config WHERE key = ?', ['dip_index_version']);
    return result === indexFileName;
  }

  async populateDatabase(
    indexFileName: string,
    logicalPaths: string[],
    metadataMap: { [key: string]: any },
    physicalPathMap: { [key: string]: string }
  ): Promise<void> {
    const db = this.db;
    if (!db) throw new Error('Database non inizializzato.');

    console.log('Popolamento database in corso...');
    db.transaction(() => {
      // Pulisce le tabelle
      db.exec('DELETE FROM metadata_attributes; DELETE FROM raw_metadata; DELETE FROM physical_paths; DELETE FROM nodes; DELETE FROM config;');

      // Statements preparati
      const insertNode = db.prepare('INSERT INTO nodes (logical_path, parent_path, name, type) VALUES (?, ?, ?, ?)');
      const insertRawMeta = db.prepare('INSERT INTO raw_metadata (logical_path, data) VALUES (?, ?)');
      const insertMetaAttr = db.prepare('INSERT INTO metadata_attributes (logical_path, key, value) VALUES (?, ?, ?)');
      const insertPhys = db.prepare('INSERT INTO physical_paths (logical_path, physical_path) VALUES (?, ?)');

      try {
        logicalPaths.forEach(path => {
          const parts = path.split('/');
          const parentPath = parts.slice(0, -1).join('/');
          let name = parts[parts.length - 1];

          // Gestione Metadati
          const metadata = metadataMap[path];
          if (metadata) {
            // 1. Cerca nome visualizzato (es. NomeDelDocumento)
            const docName = this.findValueByKey(metadata, 'NomeDelDocumento');
            if (docName) name = docName;

            // 2. Inserisce JSON grezzo
            insertRawMeta.bind([path, JSON.stringify(metadata)]).stepReset();

            // 3. Inserisce attributi indicizzati (appiattiti)
            const attributes = this.flattenMetadata(metadata);
            attributes.forEach(attr => {
              // Filtra valori troppo lunghi se necessario
              if (attr.value && attr.value.length < 2000) {
                insertMetaAttr.bind([path, attr.key, attr.value]).stepReset();
              }
            });
          }
          
          insertNode.bind([path, parentPath, name, 'file']).stepReset();
        });
        Object.entries(physicalPathMap).forEach(([path, physPath]) => {
          insertPhys.bind([path, physPath]).stepReset();
        });
      } finally {
        insertNode.finalize();
        insertRawMeta.finalize();
        insertMetaAttr.finalize();
        insertPhys.finalize();
      }

      // Aggiorna la versione
      db.exec({
        sql: 'INSERT INTO config (key, value) VALUES (?, ?)',
        bind: ['dip_index_version', indexFileName]
      });
    });
    console.log('Popolamento database completato.');
  }

  async getTreeFromDb(): Promise<FileNode[]> {
    const db = this.db;
    if (!db) return [];
    // Selezioniamo anche il 'name' che abbiamo salvato durante il popolamento
    const rows = db.exec({
      sql: 'SELECT logical_path, name FROM nodes WHERE type = ?',
      bind: ['file'],
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as { logical_path: string, name: string }[];
    return this.buildTree(rows);
  }

  async getMetadataFromDb(logicalPath: string): Promise<any> {
    const db = this.db;
    if (!db) return { error: 'DB non pronto' };
    const result = db.selectValue('SELECT data FROM raw_metadata WHERE logical_path = ?', [logicalPath]);
    return result ? JSON.parse(result as string) : { error: 'Metadati non trovati nel DB.' };
  }

  async getPhysicalPathFromDb(logicalPath: string): Promise<string | undefined> {
    const db = this.db;
    if (!db) return undefined;
    return db.selectValue('SELECT physical_path FROM physical_paths WHERE logical_path = ?', [logicalPath]) as string;
  }

  async saveIntegrityStatus(logicalPath: string, isValid: boolean, calculatedHash: string, expectedHash: string): Promise<void> {
    const db = this.db;
    if (!db) return;
    const now = new Date().toISOString();
    db.exec({
      sql: 'INSERT OR REPLACE INTO file_integrity (logical_path, is_valid, calculated_hash, expected_hash, verified_at) VALUES (?, ?, ?, ?, ?)',
      bind: [logicalPath, isValid ? 1 : 0, calculatedHash, expectedHash, now]
    });
  }

  async getIntegrityStatus(logicalPath: string): Promise<{ isValid: boolean, calculatedHash: string, expectedHash: string, verifiedAt: string } | null> {
    const db = this.db;
    if (!db) return null;
    const result = db.exec({
      sql: 'SELECT is_valid, calculated_hash, expected_hash, verified_at FROM file_integrity WHERE logical_path = ?',
      bind: [logicalPath],
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as any[];
    
    if (result && result.length > 0) {
      return {
        isValid: result[0].is_valid === 1,
        calculatedHash: result[0].calculated_hash,
        expectedHash: result[0].expected_hash,
        verifiedAt: result[0].verified_at
      };
    }
    return null;
  }

  /**
   * Recupera gli attributi metadati indicizzati per una visualizzazione pulita (Key-Value).
   */
  async getMetadataAttributes(logicalPath: string): Promise<{ key: string; value: string }[]> {
    const db = this.db;
    if (!db) return [];

    const rows = db.exec({
      sql: 'SELECT key, value FROM metadata_attributes WHERE logical_path = ? ORDER BY key',
      bind: [logicalPath],
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as { key: string, value: string }[];

    return rows;
  }

  /**
   * Recupera tutte le chiavi univoche presenti nei metadati per popolare i filtri.
   * 
   * Usa FilterManager per estrarre chiavi FLATTENED dai metadati completi.
   * Invece di chiavi come "metadata_attributes_key_1", restituisce chiavi pulite come:
   * - isPrimary
   * - fileName
   * - documentType
   * etc.
   * 
   * Questo permette all'utente di usare filtri globali più intuitivi.
   */
  async getAvailableMetadataKeys(): Promise<string[]> {
    const db = this.db;
    if (!db) return [];

    // Recupera TUTTI i metadati dal database per estrarre le chiavi flattened
    const rows = db.exec({
      sql: 'SELECT data FROM raw_metadata WHERE data IS NOT NULL',
      rowMode: 'array',
      returnValue: 'resultRows'
    }) as [string][];

    const metadataList = rows
      .map(r => {
        try {
          return JSON.parse(r[0]);
        } catch {
          return {};
        }
      });

    // Usa FilterManager per estrarre chiavi flattened univoche
    const flattenedKeys = FilterManager.extractAvailableKeys(metadataList);

    console.log('[DatabaseService] Chiavi metadati flattened disponibili:', flattenedKeys.length);
    return flattenedKeys;
  }

  /**
   * Ottiene i filtri organizzati in gruppi per la visualizzazione optgroup.
   * 
   * Raggruppa i filtri per sezione gerarchica e mostra solo il nome significativo.
   */
  async getGroupedFilterKeys(): Promise<
    {
      groupLabel: string;
      groupPath: string;
      options: Array<{ value: string; label: string }>;
    }[]
  > {
    const keys = await this.getAvailableMetadataKeys();
    return FilterManager.groupKeysForSelect(keys);
  }

  /**
   * Ottiene la mappa di consolidamento per i filtri.
   * Usata internamente durante la ricerca per espandere filtri consolidati.
   */
  async getFilterConsolidationMap(): Promise<Map<string, string[]>> {
    const keys = await this.getAvailableMetadataKeys();
    return FilterManager.buildFilterConsolidationMap(keys);
  }

  /**
   * Cerca documenti combinando ricerca per nome e filtri GLOBALI sui metadati.
   * 
   * I filtri sono ora GLOBALI: un singolo filtro "isPrimary" si applica a TUTTI i file,
   * indipendentemente da dove la proprietà appaia nella struttura (fileinformation[0], [1], etc.)
   * 
   * Funzionamento:
   * 1. Cerca i file per nome (se fornito)
   * 2. Per ogni file trovato, recupera i metadati COMPLETI
   * 3. Usa FilterManager per flattened i metadati e applicare i filtri globali
   * 4. Restituisce solo i file che matchano TUTTI i criteri di filtro
   */
  async searchDocuments(nameQuery: string, filters: Filter[]): Promise<FileNode[]> {
    const db = this.db;
    if (!db) return [];

    // Step 1: Trova i file per nome
    let sql = "SELECT logical_path, name FROM nodes WHERE type = 'file'";
    const params: string[] = [];

    if (nameQuery && nameQuery.trim() !== '') {
      sql += ' AND LOWER(name) LIKE LOWER(?)';
      params.push(`%${nameQuery.trim()}%`);
    }

    console.log('[DatabaseService] Query Ricerca (nome):', sql, 'Parametri:', params);

    const rows = db.exec({
      sql: sql,
      bind: params,
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as { logical_path: string, name: string }[];

    console.log('[DatabaseService] File trovati per nome:', rows.length);

    // Step 2 & 3: Applica i filtri globali usando FilterManager
    const filteredNodes: FileNode[] = [];

    // Espandi i filtri consolidati
    const consolidationMap = await this.getFilterConsolidationMap();
    const expandedFilters = filters.map((filter) => {
      // Se il filtro è un nome significativo (senza percorsi separati da .),
      // e ha più fullPath associati, crea filtri per tutti
      const associatedPaths = consolidationMap.get(filter.key);
      
      if (associatedPaths && associatedPaths.length > 1) {
        // Ritorna un oggetto speciale che rappresenta "uno qualsiasi dei fullPath"
        return {
          ...filter,
          _expandedPaths: associatedPaths // Marker interno per indicare che questo filtro deve essere applicato con OR logic
        };
      }
      return filter;
    });

    for (const row of rows) {
      const metadata = await this.getMetadataFromDb(row.logical_path);
      
      // Usa FilterManager per controllare se i metadati matchano i filtri
      const flatMetadata = FilterManager.flattenMetadata(metadata);
      
      // Applica i filtri con OR logic per quelli espansi
      let matchesAllFilters = true;
      for (const filter of expandedFilters) {
        const expandedFilter = filter as any;
        if (expandedFilter._expandedPaths) {
          // Per i filtri espansi, controlla se ALMENO UNO dei fullPath matcha
          const matchesAny = expandedFilter._expandedPaths.some((fullPath: string) => {
            return FilterManager.matchesFilters(flatMetadata, [{ key: fullPath, value: filter.value }]);
          });
          if (!matchesAny) {
            matchesAllFilters = false;
            break;
          }
        } else {
          // Per i filtri normali, usa la logica AND
          if (!FilterManager.matchesFilters(flatMetadata, [filter])) {
            matchesAllFilters = false;
            break;
          }
        }
      }

      if (matchesAllFilters && (expandedFilters.length === 0 || filters.length === 0)) {
        // Se non ci sono filtri, includi comunque il file
        matchesAllFilters = true;
      } else if (matchesAllFilters) {
        // File matcha tutti i filtri (con OR logic per quelli espansi)
      } else {
        // File non matcha
        matchesAllFilters = false;
      }

      if (matchesAllFilters || filters.length === 0) {
        filteredNodes.push({
          name: row.name,
          path: row.logical_path,
          type: 'file',
          children: []
        });
      }
    }

    console.log('[DatabaseService] Risultati dopo filtri globali:', filteredNodes.length);

    // Ricostruisce l'albero parziale con i risultati filtrati
    return this.buildTree(filteredNodes.map(n => ({ logical_path: n.path, name: n.name })), true);
  }

  /**
   * Scarica il database corrente come file .sqlite3 sul computer dell'utente.
   * Utile per il debugging con "DB Browser for SQLite".
   */
  exportDatabase(): void {
    if (!this.db || !this.sqlite3 || !this.db.pointer) return;
    
    // Usa l'API C di SQLite per esportare l'intero DB come array di byte
    const byteArray = this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer);
    const blob = new Blob([byteArray], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dip_debug.sqlite3';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Questa funzione è identica a quella in DipReaderService, potremmo centralizzarla qui.
  private buildTree(nodes: { logical_path: string, name: string }[], expandAll = false): FileNode[] {
    const root: FileNode[] = [];
    const folderMap = new Map<string, FileNode>();

    nodes.forEach(nodeInfo => {
      const path = nodeInfo.logical_path;
      const parts = path.split('/');
      let currentLevel = root;
      let currentPath = '';

      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isFile = index === parts.length - 1;

        if (isFile) {
          const fileNode: FileNode = {
            name: nodeInfo.name, // Usa il nome salvato nel DB (es. "NomeDelDocumento")
            path: path, // Il percorso logico completo per i file
            type: 'file',
            children: [],
          };
          currentLevel.push(fileNode);
        } else {
          // È una cartella
          let folderNode = folderMap.get(currentPath);
          if (!folderNode) {
            folderNode = { name: part, path: currentPath, type: 'folder', children: [], expanded: expandAll };
            folderMap.set(currentPath, folderNode);
            currentLevel.push(folderNode);
          }
          currentLevel = folderNode.children;
        }
      });
    });
    return root;
  }

  /**
   * Appiattisce un oggetto metadati complesso in una lista di coppie chiave-valore.
   * Utile per popolare la tabella di ricerca.
   */
  private flattenMetadata(obj: any, prefix = ''): { key: string, value: string }[] {
    let results: { key: string, value: string }[] = [];
    if (!obj || typeof obj !== 'object') return results;

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];
        const newKey = prefix ? `${prefix}.${key}` : key;

        if (typeof value === 'object' && value !== null) {
          if ('#text' in value) {
            results.push({ key: newKey, value: String(value['#text']) });
          } else if (Array.isArray(value)) {
            value.forEach((item, idx) => {
              results = results.concat(this.flattenMetadata(item, `${newKey}[${idx}]`));
            });
          } else {
            results = results.concat(this.flattenMetadata(value, newKey));
          }
        } else {
          results.push({ key: newKey, value: String(value) });
        }
      }
    }
    return results;
  }

  /**
   * Cerca ricorsivamente un valore in un oggetto tramite la sua chiave.
   * Utile per estrarre 'NomeDelDocumento' dai metadati strutturati.
   */
  public findValueByKey(obj: any, key: string): string | null {
    if (!obj || typeof obj !== 'object') {
      return null;
    }

    // Caso base: la chiave è una proprietà diretta dell'oggetto
    if (key in obj) {
      const value = obj[key];
      // Il parser XML potrebbe creare un oggetto { '#text': 'valore' }
      if (typeof value === 'object' && value !== null && '#text' in value) {
        return value['#text'];
      }
      if (typeof value === 'string') {
        return value;
      }
    }

    // Passo ricorsivo: cerca nelle proprietà dell'oggetto
    for (const k in obj) {
      if (obj.hasOwnProperty(k)) {
        const found = this.findValueByKey(obj[k], key);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  /**
   * Esegue una ricerca full-text o parziale sui metadati indicizzati.
   */
  async searchMetadata(query: string, keyFilter?: string): Promise<FileNode[]> {
    const db = this.db;
    if (!db) return [];

    let sql = `
      SELECT DISTINCT n.logical_path, n.name 
      FROM nodes n
      JOIN metadata_attributes ma ON n.logical_path = ma.logical_path
      WHERE ma.value LIKE ?
    `;
    const params: string[] = [`%${query}%`];

    if (keyFilter) {
      sql += ' AND ma.key LIKE ?';
      params.push(`%${keyFilter}%`);
    }

    const rows = db.exec({
      sql: sql,
      bind: params,
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as { logical_path: string, name: string }[];

    return this.buildTree(rows, true); // Espande anche per la ricerca metadati
  }

  /**
   * Ricerca file per nome
   * @param nameQuery Termine di ricerca
   * @returns Array di percorsi logici che corrispondono
   */
  async searchNodesByName(nameQuery: string): Promise<string[]> {
    const db = this.db;
    if (!db || !nameQuery.trim()) return [];

    const rows = db.exec({
      sql: 'SELECT DISTINCT logical_path FROM nodes WHERE name LIKE ?',
      bind: [`%${nameQuery}%`],
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as { logical_path: string }[];

    return rows.map(r => r.logical_path);
  }

  /**
   * Alias per getAvailableMetadataKeys() per coerenza naming
   */
  async getAllMetadataKeys(): Promise<string[]> {
    return await this.getAvailableMetadataKeys();
  }

  /**
   * Alias per getGroupedFilterKeys() per coerenza naming
   */
  async getGroupedMetadataKeys(): Promise<
    Array<{
      groupLabel: string;
      groupPath: string;
      options: Array<{ value: string; label: string }>;
    }>
  > {
    return await this.getGroupedFilterKeys();
  }
}
