import { Injectable } from '@angular/core';
// Importiamo SOLO il tipo per TypeScript, così Vite non tocca il pacchetto a runtime
import type sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { FileNode } from './dip-reader.service';
import { FilterManager, Filter } from './filter-manager';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type DB = InstanceType<Sqlite3['oo1']['OpfsDb']>;

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private db: DB | null = null;
  private sqlite3: Sqlite3 | null = null;
  private dbReady = false;

  constructor() {}

  async initializeDb(): Promise<void> {
    if (this.dbReady) return;

    try {
      console.log('Inizializzazione database SQLite...');
      
      // Caricamento dinamico del modulo JS dalla cartella public
      // Questo bypassa il bundling di Vite e carica i file statici che abbiamo copiato
      // @ts-ignore
      const sqliteJsPath = '/sqlite3.mjs';
      const module = await import(/* @vite-ignore */ sqliteJsPath);
      const initFunc = module.default as typeof sqlite3InitModule;

      const sqlite3: Sqlite3 = await initFunc({
        print: console.log,
        printErr: console.error,
        // locateFile ora funzionerà sicuramente perché il JS è nella stessa cartella del WASM (root)
        locateFile: (file: string) => {
          console.log(`[SQLite] locateFile richiesto per: ${file}`);
          // Usa endsWith per intercettare anche './sqlite3.wasm' o altri percorsi relativi
          if (file.endsWith('sqlite3.wasm')) {
            const wasmPath = '/sqlite3.wasm';
            console.log(`[SQLite] Reindirizzamento WASM a: ${wasmPath}`);
            return wasmPath;
          }
          return file;
        }
      });
      const oo = sqlite3.oo1;
      this.sqlite3 = sqlite3;
      if ('opfs' in sqlite3) {
        this.db = new oo.OpfsDb('/dip.sqlite3');
        console.log('Database OPFS aperto:', this.db.filename);
      } else {
        console.warn('OPFS non disponibile, uso DB in memoria (non persistente)');
        this.db = new oo.DB('/dip.sqlite3', 'ct');
      }

      const schemaPath = '/database.sql';
      const schemaResponse = await fetch(schemaPath);
      if (!schemaResponse.ok) {
        throw new Error(`Impossibile caricare lo schema SQL da ${schemaPath}: ${schemaResponse.status}`);
      }
      const schemaSql = await schemaResponse.text();

      this.db.exec(schemaSql);
      this.dbReady = true;
      console.log('Tabelle SQLite create/verificate (Nuova Struttura).');
    } catch (err: any) {
      console.error('Errore durante inizializzazione DB:', err.message);
    }
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
      // Pulisce le tabelle (ordine per rispetto FK soft)
      db.exec([
        'DELETE FROM metadata',
        'DELETE FROM node_document',
        'DELETE FROM file',
        'DELETE FROM document',
        'DELETE FROM aip',
        'DELETE FROM document_class',
        'DELETE FROM archival_process',
        'DELETE FROM metadata_attributes',
        'DELETE FROM raw_metadata',
        'DELETE FROM physical_paths',
        'DELETE FROM nodes',
        'DELETE FROM config'
      ].join('; '));

      // Statements preparati layer tecnico
      const insertNode = db.prepare('INSERT INTO nodes (logical_path, parent_path, name, type) VALUES (?, ?, ?, ?)');
      const insertRawMeta = db.prepare('INSERT INTO raw_metadata (logical_path, data) VALUES (?, ?)');
      const insertMetaAttr = db.prepare('INSERT INTO metadata_attributes (logical_path, key, value) VALUES (?, ?, ?)');
      const insertPhys = db.prepare('INSERT INTO physical_paths (logical_path, physical_path) VALUES (?, ?)');

      // Statements preparati layer archivistico
      const insertArchivalProcess = db.prepare('INSERT OR IGNORE INTO archival_process (uuid) VALUES (?)');
      const insertDocumentClass = db.prepare('INSERT OR IGNORE INTO document_class (class_name) VALUES (?)');
      const insertAip = db.prepare('INSERT OR IGNORE INTO aip (uuid, document_class_id, archival_process_uuid) VALUES (?, ?, ?)');
      const insertDocument = db.prepare('INSERT OR IGNORE INTO document (root_path, aip_uuid) VALUES (?, ?)');
      const insertFile = db.prepare('INSERT OR IGNORE INTO file (relative_path, is_main, document_id) VALUES (?, ?, ?)');
      const insertNodeDocument = db.prepare('INSERT OR REPLACE INTO node_document (logical_path, document_id) VALUES (?, ?)');
      
      // Mappe per tracciare gli ID creati
      const documentClassMap: { [key: string]: number } = {};
      const documentMap: { [key: string]: number } = {};
      let nextDocumentClassId = 1;
      let nextDocumentId = 1;

      try {
        // ═════════════════════════════════════════════════════════════════════
        // LOOP PRINCIPALE: Popola sia layer TECNICO che layer ARCHIVISTICO
        // ═════════════════════════════════════════════════════════════════════
        // Per ogni file nel DIP:
        // 1. LAYER TECNICO: Inserisce in nodes, raw_metadata, metadata_attributes
        //    → Serve per UI (albero, ricerca, visualizzazione)
        // 2. LAYER ARCHIVISTICO: Estrae info da metadati e popola aip, document, file
        //    → Serve per modello archivistico (AIP, classi, procedimenti, soggetti)
        // 3. PONTE: Collega logical_path (tecnico) a document_id (archivistico)
        //    → Via tabella node_document
        // ═════════════════════════════════════════════════════════════════════
        
        logicalPaths.forEach(path => {
          const parts = path.split('/');
          const parentPath = parts.slice(0, -1).join('/');
          let name = parts[parts.length - 1];

          // ──────────────────────────────────────────────────────────────────
          // LAYER TECNICO: Gestione Metadati per UI
          // ──────────────────────────────────────────────────────────────────
          const metadata = metadataMap[path];
          const flatForArchive = this.flattenMetadata(metadata);
          if (metadata) {
            // 1. Cerca nome visualizzato (es. NomeDelDocumento)
            const docName = this.findValueByKey(metadata, 'NomeDelDocumento');
            if (docName) name = docName;

            // 2. Inserisce JSON grezzo per visualizzazione completa
            insertRawMeta.bind([path, JSON.stringify(metadata)]).stepReset();

            // 3. Inserisce attributi indicizzati (appiattiti) per ricerca full-text
            const attributes = this.flattenMetadata(metadata);
            attributes.forEach(attr => {
              // Filtra valori troppo lunghi se necessario
              if (attr.value && attr.value.length < 2000) {
                insertMetaAttr.bind([path, attr.key, attr.value]).stepReset();
              }
            });
          }
          
          // Inserisci nodo nell'albero tecnico
          insertNode.bind([path, parentPath, name, 'file']).stepReset();

          // ──────────────────────────────────────────────────────────────────
          // LAYER ARCHIVISTICO: Popolamento modello documentale
          // ──────────────────────────────────────────────────────────────────
          const archiveInfo = this.extractArchiveInfo(flatForArchive, logicalPaths[0] || '');
          if (archiveInfo?.aip_uuid) {
            // 1. Processo Archivistico (opzionale)
            if (archiveInfo.archival_process_uuid) {
              insertArchivalProcess.bind([archiveInfo.archival_process_uuid]).stepReset();
            }

            // 2. Classe Documentale
            let documentClassId = 0;
            if (archiveInfo.document_class_name) {
              if (!documentClassMap[archiveInfo.document_class_name]) {
                documentClassMap[archiveInfo.document_class_name] = nextDocumentClassId++;
              }
              documentClassId = documentClassMap[archiveInfo.document_class_name];
              insertDocumentClass.bind([archiveInfo.document_class_name]).stepReset();
            }

            // 3. AIP (Archival Information Package)
            insertAip.bind([archiveInfo.aip_uuid, documentClassId || null, archiveInfo.archival_process_uuid || null]).stepReset();

            // 4. Document (entità documentale)
            const rootPath = archiveInfo.root_path || parentPath || path;
            const docKey = `${rootPath}::${archiveInfo.aip_uuid}`;
            if (!documentMap[docKey]) {
              documentMap[docKey] = nextDocumentId++;
            }
            insertDocument.bind([rootPath, archiveInfo.aip_uuid]).stepReset();
            const documentId = documentMap[docKey];

            if (documentId) {
              // 5. File mapping (percorso relativo + flag is_main)
              const relativePath = physicalPathMap[path] || path;
              const isMain = this.isMainFile(metadata);
              insertFile.bind([relativePath, isMain ? 1 : 0, documentId]).stepReset();

              // 6. PONTE: Collega logical_path (tecnico) a document_id (archivistico)
              insertNodeDocument.bind([path, documentId]).stepReset();
            }
          }
        });
        Object.entries(physicalPathMap).forEach(([path, physPath]) => {
          insertPhys.bind([path, physPath]).stepReset();
        });
      } finally {
        insertNode.finalize();
        insertRawMeta.finalize();
        insertMetaAttr.finalize();
        insertPhys.finalize();
        insertArchivalProcess.finalize();
        insertDocumentClass.finalize();
        insertAip.finalize();
        insertDocument.finalize();
        insertFile.finalize();
        insertNodeDocument.finalize();
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
    const startTime = performance.now();
    console.log('[PERFORMANCE] Inizio ricerca - Query:', nameQuery, 'Filtri:', filters.length);
    
    const db = this.db;
    if (!db) return [];

    // Step 1: Trova i file per nome
    const sqlStartTime = performance.now();
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

    const sqlEndTime = performance.now();
    console.log(`[PERFORMANCE] Query SQL completata in ${(sqlEndTime - sqlStartTime).toFixed(2)}ms - File trovati:`, rows.length);

    // Step 2 & 3: Applica i filtri globali usando FilterManager
    const filterStartTime = performance.now();
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

    let metadataFetchTime = 0;
    let flattenTime = 0;
    let filterCheckTime = 0;
    
    for (const row of rows) {
      const fetchStart = performance.now();
      const metadata = await this.getMetadataFromDb(row.logical_path);
      metadataFetchTime += performance.now() - fetchStart;
      
      // Usa FilterManager per controllare se i metadati matchano i filtri
      const flattenStart = performance.now();
      const flatMetadata = FilterManager.flattenMetadata(metadata);
      flattenTime += performance.now() - flattenStart;
      
      // Applica i filtri con OR logic per quelli espansi
      const filterCheckStart = performance.now();
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

      filterCheckTime += performance.now() - filterCheckStart;
      
      if (matchesAllFilters || filters.length === 0) {
        filteredNodes.push({
          name: row.name,
          path: row.logical_path,
          type: 'file',
          children: []
        });
      }
    }

    const filterEndTime = performance.now();
    const totalFilterTime = filterEndTime - filterStartTime;
    console.log(`[PERFORMANCE] Filtraggio completato in ${totalFilterTime.toFixed(2)}ms:`);
    console.log(`  - Recupero metadati: ${metadataFetchTime.toFixed(2)}ms (${(metadataFetchTime/rows.length).toFixed(2)}ms/file)`);
    console.log(`  - Flatten metadati: ${flattenTime.toFixed(2)}ms (${(flattenTime/rows.length).toFixed(2)}ms/file)`);
    console.log(`  - Check filtri: ${filterCheckTime.toFixed(2)}ms (${(filterCheckTime/rows.length).toFixed(2)}ms/file)`);
    console.log(`  - Risultati filtrati: ${filteredNodes.length}/${rows.length} file`);

    // Ricostruisce l'albero parziale con i risultati filtrati
    const treeStartTime = performance.now();
    const tree = this.buildTree(filteredNodes.map(n => ({ logical_path: n.path, name: n.name })), true);
    const treeEndTime = performance.now();
    
    const totalTime = treeEndTime - startTime;
    console.log(`[PERFORMANCE] Albero ricostruito in ${(treeEndTime - treeStartTime).toFixed(2)}ms`);
    console.log(`[PERFORMANCE] TOTALE ricerca completata in ${totalTime.toFixed(2)}ms`);
    console.log(`[PERFORMANCE] Breakdown: SQL=${((sqlEndTime-sqlStartTime)/totalTime*100).toFixed(1)}%, Filtri=${(totalFilterTime/totalTime*100).toFixed(1)}%, Tree=${((treeEndTime-treeStartTime)/totalTime*100).toFixed(1)}%`);
    
    return tree;
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
   * Estrae informazioni archivistiche complete dai metadati flatten.
   * Questo metodo raccoglie tutti i dati necessari per popolare il layer archivistico:
   * - AIP UUID e processo archivistico
   * - Classe documentale
   * - Informazioni su procedimento amministrativo
   * - Tipo di aggregazione documentale
   * - Soggetti coinvolti (persone fisiche/giuridiche, PA, etc.)
   * 
   * @param flatMetadata Metadati appiattiti in formato key-value
   * @param defaultRoot Percorso di fallback se non trovato nei metadati
   * @returns Oggetto con tutte le informazioni archivistiche, o null se manca l'AIP UUID
   */
  private extractArchiveInfo(flatMetadata: { key: string; value: string }[], defaultRoot: string) {
    const aip_uuid = this.extractAipUuid(flatMetadata);
    const archival_process_uuid = this.extractProcessUuid(flatMetadata);
    const document_class_name = this.extractDocumentClass(flatMetadata);
    const root_path = this.extractRootPath(flatMetadata, defaultRoot);
    const procedure_info = this.extractProcedureInfo(flatMetadata);
    const aggregation_type = this.extractAggregationType(flatMetadata);
    const subjects = this.extractSubjects(flatMetadata);

    if (!aip_uuid) {
      console.warn('[extractArchiveInfo] AIP UUID non trovato, skip popolamento archivistico per:', defaultRoot);
      return null;
    }
    
    return { 
      aip_uuid, 
      archival_process_uuid, 
      document_class_name, 
      root_path,
      procedure_info,
      aggregation_type,
      subjects
    };
  }

  private extractAipUuid(flatMetadata: { key: string; value: string }[]): string | null {
    const uuid = flatMetadata.find(m => /aip(id|_uuid)?/i.test(m.key) && this.isUuid(m.value))?.value;
    if (uuid) return uuid;
    return flatMetadata.find(m => this.isUuid(m.value))?.value || null;
  }

  private extractProcessUuid(flatMetadata: { key: string; value: string }[]): string | null {
    const match = flatMetadata.find(m => /process(uuid|o)?/i.test(m.key) && this.isUuid(m.value));
    return match?.value || null;
  }

  private extractDocumentClass(flatMetadata: { key: string; value: string }[]): string | null {
    const match = flatMetadata.find(m => /(classe|documentclass)/i.test(m.key) && m.value);
    return match?.value || null;
  }

  private extractRootPath(flatMetadata: { key: string; value: string }[], fallback: string): string {
    const match = flatMetadata.find(m => /document(path|root)/i.test(m.key) && m.value);
    return match?.value || fallback;
  }

  /**
   * Estrae informazioni sul procedimento amministrativo dai metadati.
   * @returns Oggetto con URI, title, subject_of_interest, o null se non trovato
   */
  private extractProcedureInfo(flatMetadata: { key: string; value: string }[]): { 
    catalog_uri?: string; 
    title?: string; 
    subject_of_interest?: string;
  } | null {
    const catalogUri = flatMetadata.find(m => 
      /(catalog|catalogo)(uri|link|url)/i.test(m.key) && m.value
    )?.value;
    
    const title = flatMetadata.find(m => 
      /(procedure|procedimento)(title|titolo|name|nome)/i.test(m.key) && m.value
    )?.value;
    
    const subject = flatMetadata.find(m => 
      /(subject|oggetto|interesse)/i.test(m.key) && m.value
    )?.value;

    if (catalogUri || title || subject) {
      return {
        catalog_uri: catalogUri,
        title: title,
        subject_of_interest: subject
      };
    }
    return null;
  }

  /**
   * Estrae il tipo di aggregazione documentale dai metadati.
   * @returns Tipo aggregazione (es. 'fascicolo', 'serie', 'dossier') o null
   */
  private extractAggregationType(flatMetadata: { key: string; value: string }[]): string | null {
    const match = flatMetadata.find(m => 
      /(aggregation|aggregazione)(type|tipo)/i.test(m.key) && m.value
    );
    return match?.value || null;
  }

  /**
   * Estrae informazioni sui soggetti (persone fisiche, giuridiche, etc.) dai metadati.
   * @returns Array di soggetti con tipo e dati identificativi
   */
  private extractSubjects(flatMetadata: { key: string; value: string }[]): Array<{
    type: 'PF' | 'PG' | 'PAI' | 'PAE' | 'AS' | 'SQ';
    identifier?: string;
    name?: string;
    role?: string;
  }> {
    const subjects: Array<any> = [];
    
    // Pattern per diversi tipi di soggetti
    const patterns = [
      { type: 'PF' as const, regex: /(person|persona)(fisica|naturale)/i },
      { type: 'PG' as const, regex: /(person|persona)(giuridica|legal)/i },
      { type: 'PAI' as const, regex: /(pubblica|amministrazione)(interna|internal)/i },
      { type: 'PAE' as const, regex: /(pubblica|amministrazione)(esterna|external)/i },
      { type: 'AS' as const, regex: /(altro|other)(soggetto|subject)/i },
      { type: 'SQ' as const, regex: /(soggetto|subject)(qualificato|qualified)/i }
    ];

    patterns.forEach(pattern => {
      const matches = flatMetadata.filter(m => pattern.regex.test(m.key));
      if (matches.length > 0) {
        // Cerca identificatore, nome, ruolo associati
        const identifier = flatMetadata.find(m => 
          new RegExp(`${pattern.type.toLowerCase()}.*id`, 'i').test(m.key)
        )?.value;
        
        const name = flatMetadata.find(m => 
          new RegExp(`${pattern.type.toLowerCase()}.*(name|nome)`, 'i').test(m.key)
        )?.value;
        
        const role = flatMetadata.find(m => 
          new RegExp(`${pattern.type.toLowerCase()}.*(role|ruolo)`, 'i').test(m.key)
        )?.value;

        if (identifier || name) {
          subjects.push({
            type: pattern.type,
            identifier,
            name,
            role
          });
        }
      }
    });

    return subjects;
  }

  private isMainFile(metadata: any): boolean {
    const flat = this.flattenMetadata(metadata || {});
    return flat.some(m => /isprimary|primary/i.test(m.key) && /true|1/i.test(m.value));
  }

  private isUuid(value: string): boolean {
    return /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value || '');
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

  // ═════════════════════════════════════════════════════════════════════════
  // API LAYER ARCHIVISTICO (Fase 4)
  // ═════════════════════════════════════════════════════════════════════════
  // Metodi pubblici per interrogare il modello archivistico.
  // Permettono di navigare la struttura AIP → Document → File
  // e recuperare informazioni su classi, processi, procedimenti, soggetti.
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Recupera informazioni sul documento archivistico associato a un logical_path.
   * @param logicalPath Percorso logico del file nell'albero tecnico
   * @returns Info documento (ID, AIP UUID, classe, root path) o null se non trovato
   */
  async getDocumentInfo(logicalPath: string): Promise<{ 
    documentId: number;
    aipUuid: string;
    documentClassName: string | null;
    rootPath: string;
  } | null> {
    const db = this.db;
    if (!db) return null;

    const row = db.exec({
      sql: `
        SELECT 
          d.id as documentId,
          d.aip_uuid as aipUuid,
          d.root_path as rootPath,
          dc.class_name as documentClassName
        FROM node_document nd
        JOIN document d ON nd.document_id = d.id
        JOIN aip a ON d.aip_uuid = a.uuid
        LEFT JOIN document_class dc ON a.document_class_id = dc.id
        WHERE nd.logical_path = ?
      `,
      bind: [logicalPath],
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as Array<{ documentId: number; aipUuid: string; rootPath: string; documentClassName: string | null }>;

    return row[0] || null;
  }

  /**
   * Recupera informazioni sull'AIP (Archival Information Package).
   * @param aipUuid UUID dell'AIP
   * @returns Info AIP (UUID, classe documentale, processo) o null se non trovato
   */
  async getAipInfo(aipUuid: string): Promise<{
    uuid: string;
    documentClassName: string | null;
    archivalProcessUuid: string | null;
  } | null> {
    const db = this.db;
    if (!db) return null;

    const row = db.exec({
      sql: `
        SELECT 
          a.uuid,
          dc.class_name as documentClassName,
          a.archival_process_uuid as archivalProcessUuid
        FROM aip a
        LEFT JOIN document_class dc ON a.document_class_id = dc.id
        WHERE a.uuid = ?
      `,
      bind: [aipUuid],
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as Array<{ uuid: string; documentClassName: string | null; archivalProcessUuid: string | null }>;

    return row[0] || null;
  }

  /**
   * Recupera tutti i documenti di un'AIP specifica.
   * @param aipUuid UUID dell'AIP
   * @returns Array di documenti con ID e root_path
   */
  async getDocumentsByAip(aipUuid: string): Promise<Array<{ id: number; rootPath: string }>> {
    const db = this.db;
    if (!db) return [];

    const rows = db.exec({
      sql: `
        SELECT id, root_path as rootPath
        FROM document
        WHERE aip_uuid = ?
      `,
      bind: [aipUuid],
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as Array<{ id: number; rootPath: string }>;

    return rows;
  }

  /**
   * Recupera tutti i file di un documento specifico.
   * @param documentId ID del documento
   * @returns Array di file con percorso relativo e flag is_main
   */
  async getFilesByDocument(documentId: number): Promise<Array<{ relativePath: string; isMain: boolean }>> {
    const db = this.db;
    if (!db) return [];

    const rows = db.exec({
      sql: `
        SELECT relative_path as relativePath, is_main as isMain
        FROM file
        WHERE document_id = ?
      `,
      bind: [documentId],
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as Array<{ relativePath: string; isMain: number }>;

    return rows.map(r => ({ relativePath: r.relativePath, isMain: r.isMain === 1 }));
  }

  /**
   * Recupera tutte le classi documentali presenti nel database.
   * @returns Array di classi con ID e nome
   */
  async getAllDocumentClasses(): Promise<Array<{ id: number; className: string }>> {
    const db = this.db;
    if (!db) return [];

    const rows = db.exec({
      sql: 'SELECT id, class_name as className FROM document_class ORDER BY class_name',
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as Array<{ id: number; className: string }>;

    return rows;
  }

  /**
   * Conta i documenti per ogni classe documentale.
   * @returns Array con nome classe e conteggio
   */
  async getDocumentCountByClass(): Promise<Array<{ className: string; count: number }>> {
    const db = this.db;
    if (!db) return [];

    const rows = db.exec({
      sql: `
        SELECT 
          dc.class_name as className,
          COUNT(DISTINCT d.id) as count
        FROM document_class dc
        JOIN aip a ON dc.id = a.document_class_id
        JOIN document d ON a.uuid = d.aip_uuid
        GROUP BY dc.class_name
        ORDER BY count DESC
      `,
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as Array<{ className: string; count: number }>;

    return rows;
  }

  /**
   * Verifica se un file è il file principale di un documento.
   * @param logicalPath Percorso logico del file
   * @returns true se è il file principale, false altrimenti
   */
  async isFilePrimary(logicalPath: string): Promise<boolean> {
    const db = this.db;
    if (!db) return false;

    const result = db.exec({
      sql: `
        SELECT f.is_main
        FROM node_document nd
        JOIN file f ON nd.document_id = f.document_id
        WHERE nd.logical_path = ?
      `,
      bind: [logicalPath],
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as Array<{ is_main: number }>;

    return result[0]?.is_main === 1;
  }
}
