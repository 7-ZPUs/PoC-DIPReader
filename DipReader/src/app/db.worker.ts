/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { pipeline, env } from '@xenova/transformers';

// 1. CONFIGURATION
// Point to the local assets folder.
// useBrowserCache = false forces it to ignore the old corrupted cache.
env.localModelPath = '/assets/models/';
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false; 

let db: any;
let embedder: any;

addEventListener('message', async ({ data }) => {
  try {
    switch (data.type) {
      case 'INIT':
        await initSystem(data.payload);
        postMessage({ type: 'INIT_RESULT', status: 'ok' });
        break;
      case 'INDEX_METADATA':
        await ingestDocument(data.payload);
        postMessage({ type: 'INDEX_RESULT', status: 'ok', id: data.payload.id });
        break;
      case 'SEARCH':
        const results = await search(data.payload.query);
        postMessage({ type: 'SEARCH_RESULT', results });
        break;
      case 'REINDEX_ALL':
        await reindexAllDocuments();
        postMessage({ type: 'REINDEX_COMPLETE', status: 'ok' });
        break;
    }
  } catch (err: any) {
    console.error('Worker Error:', err);
    postMessage({ type: 'ERROR', error: err });
  }
});

async function initSystem(config: { wasmUrl: string }) {
  console.log('Worker: Initializing AI (v1.5-fixed)...');

  // 2. LOAD AI MODEL
  // IMPORTANT: This matches your actual folder name in assets/models/nomic-ai/
  embedder = await pipeline('feature-extraction', 'nomic-ai/v1.5-fixed', {
    quantized: true,
  });
  console.log('Worker: AI Model Loaded.');

  // 3. LOAD SQLITE
  const sqlite3 = await sqlite3InitModule({
    print: console.log,
    printErr: console.error,
  });

  if ('opfs' in sqlite3) {
    db = new sqlite3.oo1.OpfsDb('/archival.sqlite3');
    console.log('Worker: DB (OPFS) opened.');
  } else {
    db = new sqlite3.oo1.DB('/archival.sqlite3', 'ct');
    console.warn('Worker: DB (Memory) opened.');
  }

  // 4. CREATE SHADOW TABLES
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(doc_id UNINDEXED, content);
    CREATE VIRTUAL TABLE IF NOT EXISTS document_vec USING vec0(doc_id INTEGER PRIMARY KEY, embedding float[768]);
  `);
  
  console.log('Worker: System Ready.');
}

async function ingestDocument({ id, text }: { id: number, text: string }) {
  if (!db) throw new Error('DB not initialized');
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  const vector = out.data;

  db.transaction(() => {
    db.exec({ sql: `INSERT OR REPLACE INTO document_fts(doc_id, content) VALUES (?, ?)`, bind: [id, text] });
    db.exec({ sql: `INSERT OR REPLACE INTO document_vec(doc_id, embedding) VALUES (?, ?)`, bind: [id, vector] });
  });
}

async function search(query: string) {
  if (!db) throw new Error('DB not initialized');
  const out = await embedder(query, { pooling: 'mean', normalize: true });
  const vector = out.data;
  const results: any[] = [];
  
  db.exec({
    sql: `SELECT doc_id, vec_distance_cosine(embedding, ?) as distance FROM document_vec ORDER BY distance ASC LIMIT 20`,
    bind: [vector],
    callback: (row: any) => results.push({ id: row[0], score: row[1] })
  });
  return results;
}

async function reindexAllDocuments() {
    if (!db) throw new Error('DB not initialized');
    console.log('Worker: Starting re-index...');
    
    // Concatenate metadata for indexing
    const rows = await db.exec({
      returnValue: 'resultRows',
      sql: `
        SELECT 
          d.id, 
          GROUP_CONCAT(m.meta_key || ': ' || m.meta_value, '. ') as combined_text
        FROM document d
        LEFT JOIN metadata m ON m.document_id = d.id
        GROUP BY d.id
      `
    });
  
    console.log(`Worker: Found ${rows.length} documents.`);
    
    for (const row of rows) {
      const id = row[0];
      const text = row[1] || `Document ${id}`; 
      await ingestDocument({ id, text });
    }
}