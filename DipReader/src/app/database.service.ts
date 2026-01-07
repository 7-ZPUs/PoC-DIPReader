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

      // Creazione tabelle se non esistono
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT
        );
        CREATE TABLE IF NOT EXISTS nodes (
          logical_path TEXT PRIMARY KEY,
          parent_path TEXT,
          name TEXT NOT NULL,
          type TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS metadata (
          logical_path TEXT PRIMARY KEY,
          data TEXT,
          FOREIGN KEY(logical_path) REFERENCES nodes(logical_path)
        );
        CREATE TABLE IF NOT EXISTS physical_paths (
          logical_path TEXT PRIMARY KEY,
          physical_path TEXT,
          FOREIGN KEY(logical_path) REFERENCES nodes(logical_path)
        );
      `);
      this.dbReady = true;
      console.log('Tabelle SQLite create/verificate.');
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
      // Pulisce le vecchie tabelle
      db.exec('DELETE FROM nodes; DELETE FROM metadata; DELETE FROM physical_paths; DELETE FROM config;');

      // Inserisce i nodi
      const insertNode = db.prepare('INSERT INTO nodes (logical_path, parent_path, name, type) VALUES (?, ?, ?, ?)');
      try {
        logicalPaths.forEach(path => {
          const parts = path.split('/');
          // Cerca il nome visualizzato nei metadati, altrimenti usa il nome del file
          const metadata = metadataMap[path];
          const docName = this.findValueByKey(metadata, 'NomeDelDocumento');
          const name = docName || parts[parts.length - 1];
          const parentPath = parts.slice(0, -1).join('/');
          
          insertNode.bind([path, parentPath, name, 'file']).stepReset();
        });
      } finally {
        insertNode.finalize();
      }

      // Inserisce i metadati
      const insertMeta = db.prepare('INSERT INTO metadata (logical_path, data) VALUES (?, ?)');
      try {
        Object.entries(metadataMap).forEach(([path, data]) => {
          insertMeta.bind([path, JSON.stringify(data)]).stepReset();
        });
      } finally {
        insertMeta.finalize();
      }

      // Inserisce i percorsi fisici
      const insertPhys = db.prepare('INSERT INTO physical_paths (logical_path, physical_path) VALUES (?, ?)');
      try {
        Object.entries(physicalPathMap).forEach(([path, physPath]) => {
          insertPhys.bind([path, physPath]).stepReset();
        });
      } finally {
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
    const result = db.selectValue('SELECT data FROM metadata WHERE logical_path = ?', [logicalPath]);
    return result ? JSON.parse(result as string) : { error: 'Metadati non trovati nel DB.' };
  }

  async getPhysicalPathFromDb(logicalPath: string): Promise<string | undefined> {
    const db = this.db;
    if (!db) return undefined;
    return db.selectValue('SELECT physical_path FROM physical_paths WHERE logical_path = ?', [logicalPath]) as string;
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
  private buildTree(nodes: { logical_path: string, name: string }[]): FileNode[] {
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
            folderNode = { name: part, path: currentPath, type: 'folder', children: [], expanded: false };
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
   * Cerca ricorsivamente un valore in un oggetto tramite la sua chiave.
   * Utile per estrarre 'NomeDelDocumento' dai metadati strutturati.
   */
  private findValueByKey(obj: any, key: string): string | null {
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
}