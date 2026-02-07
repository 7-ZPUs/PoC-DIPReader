/// <reference lib="webworker" />

import { IndexerLogic } from '../logic/indexerLogic';
import type { OpfsDatabase, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let db: any = null;
let sqlite3: Sqlite3Static;
let currentDipUUID: string | null = null;
let useOpfs = false;

// ===================================================================================
// 1. INIZIALIZZAZIONE (Fix: Assegnazione garantita)
// ===================================================================================
async function startDb(): Promise<{ status: string }> {
  try {
    console.log('[Worker] Caricamento modulo SQLite...');
    const sqlite3Instance = await (sqlite3InitModule as any)({
      print: console.log,
      printErr: console.error,
      locateFile: (file: string) => `/assets/sqlite-wasm/${file}`
    });

    // FIX CRITICO: Assegniamo l'istanza SUBITO, prima di qualsiasi controllo
    sqlite3 = sqlite3Instance;

    // Controllo robusto per OPFS
    try {
      if ('opfs' in sqlite3) {
        // Test di scrittura reale (necessario per Firefox Private / Chrome restrittivo)
        await navigator.storage.getDirectory();
        useOpfs = true;
        console.log('✅ SQLite: OPFS attivo e funzionante.');
        return { status: 'success' };
      } else {
        throw new Error('Modulo OPFS non rilevato nell\'istanza SQLite.');
      }
    } catch (e) {
      useOpfs = false;
      console.warn('⚠️ SQLite: OPFS non disponibile. Fallback in RAM.', e);
      return { status: 'memory-only' };
    }
  } catch (err: any) {
    console.error('❌ Errore Critico Init SQLite:', err);
    throw err;
  }
}

// ===================================================================================
// 2. APERTURA DATABASE (Gestione Fallback RAM)
// ===================================================================================
async function openOrCreateDatabase(dipUUID: string): Promise<void> {
  const dbFileName = `${dipUUID}.sqlite3`;

  if (db && currentDipUUID !== dipUUID) {
    try { db.close(); } catch (e) { console.warn('Warning close:', e); }
  }

  // Se OPFS è attivo proviamo ad usarlo, altrimenti andiamo in RAM
  if (useOpfs) {
    try {
      db = new sqlite3.oo1.OpfsDb(`/${dbFileName}`);
      console.log(`[Worker] DB OPFS aperto: ${dbFileName}`);
      await initSchema();
    } catch (e) {
      console.error('[Worker] Errore apertura file OPFS -> Passaggio a RAM:', e);
      useOpfs = false;
      await openOrCreateDatabase(dipUUID); // Riprova ricorsivamente in RAM
      return;
    }
  } else {
    console.log(`[Worker] Apertura DB in memoria (Volatile): ${dbFileName}`);
    db = new sqlite3.oo1.DB(':memory:', 'c');
    await initSchema();
  }

  currentDipUUID = dipUUID;
}

// ===================================================================================
// 3. GESTIONE SCHEMA (Legge schema.sql)
// ===================================================================================
async function initSchema() {
  if (!db) return;
  const schemaPath = `/assets/db/schema.sql?v=${Date.now()}`;
  
  try {
    const response = await fetch(schemaPath);
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const sql = await response.text();
    db.exec(sql);
    console.log('[Worker] Schema applicato.');
  } catch (e) {
    console.warn('[Worker] Schema esterno fallito, uso schema interno minimo.');
    db.exec(`
      CREATE TABLE IF NOT EXISTS archival_process (uuid TEXT PRIMARY KEY, process_type TEXT, description TEXT);
      CREATE TABLE IF NOT EXISTS document_class (id INTEGER PRIMARY KEY AUTOINCREMENT, class_name TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS aip (uuid TEXT PRIMARY KEY, root_path TEXT, document_class_id INTEGER, archival_process_uuid TEXT);
      CREATE TABLE IF NOT EXISTS document (id INTEGER PRIMARY KEY AUTOINCREMENT, root_path TEXT, aip_uuid TEXT);
      CREATE TABLE IF NOT EXISTS file (id INTEGER PRIMARY KEY AUTOINCREMENT, relative_path TEXT, is_main INTEGER DEFAULT 0, document_id INTEGER);
      CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, value TEXT, file_id INTEGER);
    `);
  }
}

// ===================================================================================
// 4. HANDLER MESSAGGI
// ===================================================================================
addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'INIT') {
      const result = await startDb();
      postMessage({ type: 'READY', payload: result });
    }
    else if (data.type === 'INDEX') {
      // Ora sqlite3 è garantito essere definito grazie al fix in startDb
      if (!sqlite3) throw new Error('SQLite non inizializzato (startDb fallito)');
      await openOrCreateDatabase(data.dipUUID);
      
      // Pulizia preventiva se necessario
      try {
         const res = db.exec({ sql: 'SELECT count(*) from file', returnValue: 'resultRows' });
         if (res[0][0] > 0) {
            db.exec('DELETE FROM metadata; DELETE FROM file; DELETE FROM document; DELETE FROM aip;');
         }
      } catch {}

      const indexer = new IndexerLogic(db, data.handle);
      await indexer.indexDip();
      
      postMessage({ type: 'INDEXED', dipUUID: data.dipUUID });
    }
    else if (data.type === 'QUERY') {
       if (!db) throw new Error('Database non aperto. Carica un DIP.');
       const result = db.exec({ sql: data.sql, bind: data.params || [], rowMode: 'object', returnValue: 'resultRows' });
       postMessage({ type: 'QUERY_RESULT', id: data.id, result });
    }
    else if (data.type === 'LIST_DBS') {
       if (!useOpfs) {
           postMessage({ type: 'DB_LIST', databases: [] });
           return;
       }
       try {
           const root = await navigator.storage.getDirectory();
           const dbs = [];
           for await (const [name] of root.entries()) {
               if (name.endsWith('.sqlite3')) dbs.push(name.replace('.sqlite3', ''));
           }
           postMessage({ type: 'DB_LIST', databases: dbs });
       } catch { postMessage({ type: 'DB_LIST', databases: [] }); }
    }
    else if (data.type === 'EXPORT_DB') {
        if(!db) return;
        try {
            // Verifica supporto export prima di chiamarlo
            if (sqlite3.capi.sqlite3_js_db_export) {
                const byteArray = sqlite3.capi.sqlite3_js_db_export(db.pointer);
                const blob = new Blob([byteArray], { type: 'application/x-sqlite3' });
                postMessage({ type: 'DB_BLOB', url: URL.createObjectURL(blob), filename: `${currentDipUUID}.sqlite3` });
            } else {
                throw new Error("Export non supportato in questa build");
            }
        } catch(e: any) { 
            console.error(e); 
            postMessage({ type: 'ERROR', error: 'Export fallito: ' + e.message });
        }
    }
  } catch (e: any) {
    console.error('[Worker Error]', e);
    postMessage({ type: 'ERROR', error: e.message, id: data.id });
  }
});