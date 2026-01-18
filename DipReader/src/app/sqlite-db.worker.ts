// sqlite-db.worker.ts
/// <reference lib="webworker" />

import { IndexerLogic } from '../logic/indexerLogic';
import type { OpfsDatabase, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let db: OpfsDatabase;
let sqlite3: Sqlite3Static;

async function startDb() {
  try {
    //const sqlitePath = '/sqlite3.mjs';
    //const { default: sqlite3InitModule } = await import(/* @vite-ignore */ sqlitePath);

    const sqlite3Instance: Sqlite3Static = await sqlite3InitModule({
      print: console.log,
      printErr: console.error,
      /*locateFile: (file: string) => {
        console.log(`[SQLite] locateFile richiesto per: ${file}`);
        // Usa endsWith per intercettare anche './sqlite3.wasm' o altri percorsi relativi
        if (file.endsWith('sqlite3.wasm')) {
          const wasmPath = '/sqlite3.wasm';
          console.log(`[SQLite] Reindirizzamento WASM a: ${wasmPath}`);
          return wasmPath;
        }
        return file;
      }*/
    });

    if (!('opfs' in sqlite3Instance)) {
      // Esempio: db.exec(...)
      return { status: 'memory-only' };
    }
    const dbInstance = new sqlite3Instance.oo1.OpfsDb('/my-db.sqlite3');
    console.log('SQLite pronto in OPFS');
    const schema_path = '/schema.sql';
    let schema = await fetch(schema_path).then(r => r.text())
    await dbInstance.exec(schema);
    
    db = dbInstance;
    sqlite3 = sqlite3Instance;

    return { status: 'success' };
  } catch (err) {
    // Se vedi questo log, il file .js è stato caricato ma il .wasm ha fallito
    console.error('Errore inizializzazione SQLite:', err);
    throw err;
  }
}

function exportDatabase(db: OpfsDatabase, sqlite3: Sqlite3Static): void {
  if (!db || !sqlite3 || !db.pointer) return;

  // Usa l'API C di SQLite per esportare l'intero DB come array di byte
  const byteArray = sqlite3.capi.sqlite3_js_db_export(db.pointer);
  const blob = new Blob([byteArray], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  console.log(url);
  //URL.revokeObjectURL(url); // Pulisce l'URL dopo l'uso
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
  if (data.type === 'INDEX') {
    console.log('Inizio indicizzazione...');
    const indexer = new IndexerLogic(db, data.handle);
    await indexer.indexDip();
    console.log('Indicizzazione completata!');
    exportDatabase(db, sqlite3);
    postMessage({ type: 'INDEXED' });
  }
});