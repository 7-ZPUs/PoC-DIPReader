import { Injectable } from '@angular/core';
// Importiamo SOLO il tipo per TypeScript, così Vite non tocca il pacchetto a runtime
import type sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { FileNode } from './dip-reader.service';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type DB = InstanceType<Sqlite3['oo1']['DB']>;

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
      this.db = new oo.DB('/dip.sqlite3', 'ct'); // 'c'reate, 't'race
      console.log('Database aperto:', this.db.filename);

      // Creazione tabelle ottimizzate per indicizzazione e ricerca
      this.db.exec(`
        -- Configurazione generale
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        
        -- Tabella nodi: struttura gerarchica del pacchetto
        CREATE TABLE IF NOT EXISTS nodes (
          logical_path TEXT PRIMARY KEY,
          parent_path TEXT,
          name TEXT NOT NULL,
          type TEXT NOT NULL
        );
        
        -- Metadati grezzi (JSON) per visualizzazione completa
        CREATE TABLE IF NOT EXISTS raw_metadata (
          logical_path TEXT PRIMARY KEY,
          data TEXT,
          FOREIGN KEY(logical_path) REFERENCES nodes(logical_path) ON DELETE CASCADE
        );
        
        -- Metadati indicizzati (Key-Value) per ricerca rapida
        CREATE TABLE IF NOT EXISTS metadata_attributes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          logical_path TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          FOREIGN KEY(logical_path) REFERENCES nodes(logical_path) ON DELETE CASCADE
        );
        
        -- Mappatura percorsi fisici
        CREATE TABLE IF NOT EXISTS physical_paths (
          logical_path TEXT PRIMARY KEY,
          physical_path TEXT,
          FOREIGN KEY(logical_path) REFERENCES nodes(logical_path) ON DELETE CASCADE
        );

        -- Indici per performance
        CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_path);
        CREATE INDEX IF NOT EXISTS idx_meta_attr_key ON metadata_attributes(key);
        CREATE INDEX IF NOT EXISTS idx_meta_attr_val ON metadata_attributes(value);
      `);
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
   */
  async getAvailableMetadataKeys(): Promise<string[]> {
    const db = this.db;
    if (!db) return [];
    const rows = db.exec({
      sql: 'SELECT DISTINCT key FROM metadata_attributes ORDER BY key',
      rowMode: 'array',
      returnValue: 'resultRows'
    });
    // rows è un array di array (es. [['Author'], ['Date']])
    return rows.map((r: any) => r[0] as string);
  }

  /**
   * Cerca documenti combinando ricerca per nome e filtri sui metadati.
   */
  async searchDocuments(nameQuery: string, filters: { key: string, value: string }[]): Promise<FileNode[]> {
    const db = this.db;
    if (!db) return [];

    // Usa apici singoli per i letterali SQL standard
    let sql = "SELECT logical_path, name FROM nodes WHERE type = 'file'";
    const params: string[] = [];

    if (nameQuery && nameQuery.trim() !== '') {
      // Usa LOWER per rendere la ricerca case-insensitive in modo robusto
      sql += ' AND LOWER(name) LIKE LOWER(?)';
      params.push(`%${nameQuery.trim()}%`);
    }

    // Aggiunge una condizione EXISTS per ogni filtro attivo (AND logico)
    for (const filter of filters) {
      if (filter.key && filter.value) {
        sql += ` AND EXISTS (
          SELECT 1 FROM metadata_attributes ma 
          WHERE ma.logical_path = nodes.logical_path 
          AND ma.key = ? 
          AND LOWER(ma.value) LIKE LOWER(?)
        )`;
        params.push(filter.key);
        params.push(`%${filter.value}%`);
      }
    }

    console.log('[DatabaseService] Query Ricerca:', sql, 'Parametri:', params);

    const rows = db.exec({
      sql: sql,
      bind: params,
      rowMode: 'object',
      returnValue: 'resultRows'
    }) as { logical_path: string, name: string }[];

    console.log('[DatabaseService] Risultati trovati:', rows.length);

    // Ricostruisce l'albero parziale con i risultati trovati
    return this.buildTree(rows, true); // Passiamo true per espandere i risultati
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
}