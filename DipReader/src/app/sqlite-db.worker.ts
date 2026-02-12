/// <reference lib="webworker" />

import { IndexerLogic } from '../logic/indexerLogic';
import type { OpfsDatabase, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let db: OpfsDatabase;
let sqlite3: Sqlite3Static;

async function startDb() {
  try {
    const sqlite3Instance: Sqlite3Static = await sqlite3InitModule({
      print: console.log,
      printErr: console.error,
      locateFile: (file: string) => {
        if (file.endsWith('sqlite3.wasm')) return '/sqlite3.wasm';
        if (file.endsWith('sqlite3.mjs')) return '/sqlite3.mjs';
        return file;
      }
    });

    const dbInstance = new sqlite3Instance.oo1.DB(':memory:') as unknown as OpfsDatabase;
    console.log('SQLite pronto in memoria (:memory:)');

    const schemaPath = '/database.sql';
    const schemaResponse = await fetch(schemaPath);
    if (!schemaResponse.ok) {
      throw new Error(`Impossibile caricare lo schema SQL da ${schemaPath}: ${schemaResponse.status}`);
    }
    const schema = await schemaResponse.text();
    await dbInstance.exec(schema);

    db = dbInstance;
    sqlite3 = sqlite3Instance;

    return { status: 'success' };
  } catch (err) {
    console.error('Errore inizializzazione SQLite:', err);
    throw err;
  }
}

function exportDatabase(dbHandle: OpfsDatabase, sqlite3Handle: Sqlite3Static): Blob | null {
  if (!dbHandle || !sqlite3Handle || !dbHandle.pointer) return null;

  try {
    const byteArray = sqlite3Handle.capi.sqlite3_js_db_export(dbHandle.pointer);
    const blob = new Blob([byteArray], { type: 'application/x-sqlite3' });
    console.log('[Worker] Database esportato, size:', blob.size);
    return blob;
  } catch (err) {
    console.error('[Worker] Errore export DB:', err);
    return null;
  }
}

addEventListener('message', async ({ data }) => {
  if (data.type === 'INIT') {
    try {
      const result = await startDb();
      postMessage({ type: 'READY', payload: result });
    } catch (e: any) {
      postMessage({ type: 'ERROR', error: e?.message ?? 'Init failure' });
    }
  }

  if (data.type === 'INDEX_FILES') {
    console.log('Inizio indicizzazione da FileList...');
    
    if (!db) {
      postMessage({ type: 'ERROR', error: 'Database not initialized. Call INIT first.' });
      return;
    }
    
    if (!data.files || !Array.isArray(data.files)) {
      postMessage({ type: 'ERROR', error: 'FILES non validi' });
      return;
    }
    // Converte FileList in File[] se necessario, poi passa a IndexerLogic
    // Per ora usiamo un approccio semplice: ricrea filesystem handle virtuale
    try {
      const indexer = new IndexerLogic(db, data.files);
      await indexer.indexDipFromFiles();
      const nodeCount = db.selectValue?.('SELECT COUNT(*) FROM nodes') ?? 'n/a';
      const dbBlob = exportDatabase(db, sqlite3);
      console.log('Indicizzazione completata! Nodi:', nodeCount);
      postMessage({ type: 'INDEXED', nodeCount, dbBlob });
    } catch (err: any) {
      postMessage({ type: 'ERROR', error: err?.message ?? 'Indexing failed' });
    }
  }
});
