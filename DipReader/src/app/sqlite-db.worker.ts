// sqlite-db.worker.ts
/// <reference lib="webworker" />

import { IndexerLogic } from '../logic/indexerLogic';
import type { OpfsDatabase, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let db: OpfsDatabase | null = null;
let sqlite3: Sqlite3Static;
let currentDipUUID: string | null = null;

async function startDb(): Promise<{ status: string }> {
  try {
const sqlite3Instance: Sqlite3Static = await (sqlite3InitModule as any)({
  print: console.log,
  printErr: console.error,
  locateFile: (file: string) => {
        return `/assets/sqlite-wasm/${file}`;
      }
});
    
    if (!('opfs' in sqlite3Instance)) {
      return { status: 'memory-only' };
    }
    
    sqlite3 = sqlite3Instance;
    console.log('SQLite pronto in OPFS');
    
    return { status: 'success' };
  } catch (err) {
    console.error('Errore inizializzazione SQLite:', err);
    throw err;
  }
}

async function openOrCreateDatabase(dipUUID: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dbFileName = `${dipUUID}.sqlite3`;
  let fileExists = false;

  try {
    await root.getFileHandle(dbFileName);
    fileExists = true;
    console.log(`[Worker] Database esistente trovato: ${dbFileName}`);
  } catch {
    fileExists = false;
    console.log(`[Worker] Creazione nuovo database: ${dbFileName}`);
  }

  // Chiudi il database corrente se aperto
  if (db && currentDipUUID !== dipUUID) {
    try {
      db.close();
      console.log(`[Worker] Chiuso database precedente: ${currentDipUUID}`);
    } catch (e) {
      console.warn('[Worker] Errore chiusura database:', e);
    }
  }

  // Apri o crea il database per questo DIP
  db = new sqlite3.oo1.OpfsDb(`/${dbFileName}`);
  currentDipUUID = dipUUID;

  // Se il database è nuovo, crea lo schema
  if (!fileExists) {
    const schema_path = '/assets/db/schema.sql';
    const schema = await fetch(schema_path).then(r => r.text());
    await db.exec(schema);
    console.log(`[Worker] Schema creato per: ${dbFileName}`);
  } else {
    console.log(`[Worker] Riutilizzo database esistente: ${dbFileName}`);
  }
}

function exportDatabase(db: OpfsDatabase, sqlite3: Sqlite3Static): void {
  if (!db || !sqlite3 || !db.pointer) return;

  // Usa l'API C di SQLite per esportare l'intero DB come array di byte
  const byteArray = sqlite3.capi.sqlite3_js_db_export(db.pointer);
  const blob = new Blob([byteArray], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);

  // Invia il blob URL al thread principale per il download
  const filename = currentDipUUID ? `${currentDipUUID}.sqlite3` : 'dip_debug.sqlite3';
  postMessage({ type: 'DB_BLOB', url, filename });

  console.log('[Worker] Database esportato:', url);
}

async function deleteDatabase(dipUUID: string): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const dbFileName = `${dipUUID}.sqlite3`;
    
    // Chiudi il database se è quello corrente
    if (currentDipUUID === dipUUID && db) {
      db.close();
      db = null;
      currentDipUUID = null;
    }
    
    await root.removeEntry(dbFileName);
    console.log(`[Worker] Database eliminato: ${dbFileName}`);
    return true;
  } catch (err) {
    console.error('[Worker] Errore eliminazione database:', err);
    return false;
  }
}

async function listDatabases(): Promise<string[]> {
  try {
    const root = await navigator.storage.getDirectory();
    const databases: string[] = [];
    
    for await (const [name, handle] of root.entries()) {
      if (name.endsWith('.sqlite3') && handle.kind === 'file') {
        // Estrai solo l'UUID dal nome file
        const uuid = name.replace('.sqlite3', '');
        databases.push(uuid);
      }
    }
    
    console.log(`[Worker] Database trovati: ${databases.length}`);
    return databases;
  } catch (err) {
    console.error('[Worker] Errore lista database:', err);
    return [];
  }
}

addEventListener('message', async ({ data }) => {
  if (data.type === 'INIT') {
    try {
      const result = await startDb();
      postMessage({ type: 'READY', payload: result });
    } catch (e: any) {
      postMessage({ type: 'ERROR', error: e.message });
    }
  }
  else if (data.type === 'INDEX') {
    try {
      console.log('[Worker] Inizio indicizzazione per DIP:', data.dipUUID);
      
      // Apri o crea il database per questo DIP
      await openOrCreateDatabase(data.dipUUID);
      
      // Verifica se il database ha già dati (reindicizzazione)
      const existingData = db!.exec({
        sql: 'SELECT COUNT(*) as count FROM file',
        rowMode: 'object',
        returnValue: 'resultRows'
      }) as { count: number }[];
      
      const hasData = existingData.length > 0 && existingData[0].count > 0;
      
      if (hasData) {
        console.log('[Worker] Database esistente con dati, svuotamento tabelle...');
        // Svuota tutte le tabelle per reindicizzare
        const tables = [
          'document_subject_association',
          'metadata',
          'file',
          'document',
          'aip',
          'document_class',
          'archival_process',
          'subject_pf',
          'subject_pg',
          'subject_pai',
          'subject_pae',
          'subject_as',
          'subject_sq',
          'subject',
          'phase',
          'document_aggregation',
          'administrative_procedure'
        ];
        
        for (const table of tables) {
          try {
            db!.exec(`DELETE FROM ${table}`);
          } catch (e) {
            // Ignora errori per tabelle che potrebbero non esistere
            console.warn(`[Worker] Errore svuotamento tabella ${table}:`, e);
          }
        }
      }
      
      const indexer = new IndexerLogic(db!, data.handle);
      await indexer.indexDip();
      console.log('[Worker] Indicizzazione completata!');
      
      exportDatabase(db!, sqlite3);
      postMessage({ type: 'INDEXED', dipUUID: data.dipUUID });
    } catch (e: any) {
      postMessage({ type: 'ERROR', error: e.message, id: data.id });
    }
  }
  else if (data.type === 'SWITCH_DB') {
    try {
      console.log('[Worker] Cambio database a:', data.dipUUID);
      await openOrCreateDatabase(data.dipUUID);
      postMessage({ type: 'DB_SWITCHED', dipUUID: data.dipUUID });
    } catch (e: any) {
      postMessage({ type: 'ERROR', error: e.message });
    }
  }
  else if (data.type === 'LIST_DBS') {
    try {
      const databases = await listDatabases();
      postMessage({ type: 'DB_LIST', databases });
    } catch (e: any) {
      postMessage({ type: 'ERROR', error: e.message });
    }
  }
  else if (data.type === 'DELETE_DB') {
    try {
      const success = await deleteDatabase(data.dipUUID);
      postMessage({ type: 'DB_DELETED', dipUUID: data.dipUUID, success });
    } catch (e: any) {
      postMessage({ type: 'ERROR', error: e.message });
    }
  }
  else if (data.type === 'QUERY') {
    try {
      if (!db) {
        postMessage({ type: 'ERROR', error: 'Database non inizializzato', id: data.id });
        return;
      }

      const result = db.exec({
        sql: data.sql,
        bind: data.params || [],
        rowMode: 'object',
        returnValue: 'resultRows'
      });

      postMessage({ type: 'QUERY_RESULT', id: data.id, result });
    } catch (e: any) {
      postMessage({ type: 'ERROR', error: e.message, id: data.id });
    }
  }
  else if (data.type === 'EXPORT_DB') {
    try {
      if (!db) {
        postMessage({ type: 'ERROR', error: 'Nessun database aperto' });
        return;
      }
      exportDatabase(db, sqlite3);
      postMessage({ type: 'DB_EXPORTED' });
    } catch (e: any) {
      postMessage({ type: 'ERROR', error: e.message });
    }
  }
});