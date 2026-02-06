/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { pipeline, env } from '@xenova/transformers';

// ============================================================================
// 1. CONFIGURAZIONE
// ============================================================================
env.localModelPath = '/assets/models/';
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = '/assets/onnx-wasm/';
env.backends.onnx.wasm.numThreads = 1;

// ============================================================================
// 2. STATO DEL WORKER
// ============================================================================
let db: any = null;
let embedder: any = null;
let isInitialized = false;

// CACHE IN MEMORIA: Fondamentale per la velocità senza l'estensione vec0
// Mappa: ID Documento -> Vettore (Float32Array)
const vectorCache = new Map<number, Float32Array>();

// ============================================================================
// 3. GESTIONE MESSAGGI
// ============================================================================
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
        await reindexAllDocuments(data.payload.documents);
        postMessage({ type: 'REINDEX_COMPLETE', status: 'ok' });
        break;
    }
  } catch (err: any) {
    console.error('Worker Error:', err);
    postMessage({ type: 'ERROR', error: { message: err.message } });
  }
});

// ============================================================================
// 4. FUNZIONI CORE
// ============================================================================

async function initSystem(config: { wasmUrl: string }) {
  if (!self.crossOriginIsolated) {
    console.warn("Worker: App non isolata (COOP/COEP mancanti). OPFS disabilitato, fallback in memoria.");
  }
  if (isInitialized) return;
  console.log('Worker: Avvio sistema Semantic Search (Mode: BLOB+JS)...');

  // A. Caricamento AI
  console.log('Worker: Caricamento modello AI...');
  try {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
      local_files_only: true,
    });
    console.log('Worker: Modello AI caricato con successo.');
  } catch (aiError: any) {
    console.error('Worker: ERRORE Caricamento AI:', aiError);
    throw new Error(`Impossibile caricare il modello AI: ${aiError.message}`);
  }

  // B. Caricamento SQLite con locateFile
  console.log('Worker: Inizializzazione SQLite WASM...');
  const sqlite3 = await (sqlite3InitModule as any)({
    print: console.log,
    printErr: console.error,
    proxyUri: '/assets/sqlite-wasm/sqlite3-opfs-async-proxy.js',
    locateFile: (file: string) => {
      console.log(`Worker: SQLite richiede file: ${file}`);
      return `/assets/sqlite-wasm/${file}`;
    }
  });

  // Usa un nome file DIVERSO dal database principale per evitare conflitti di lock
  const dbName = '/vectors.sqlite3';

  try {
    if ('opfs' in sqlite3) {
      db = new sqlite3.oo1.OpfsDb(dbName);
      console.log('Worker: DB Vettori aperto su OPFS.');
    } else {
      throw new Error('OPFS non disponibile');
    }
  } catch (e) {
    console.warn('Worker: Fallback in memoria (File bloccato o OPFS non supportato).');
    db = new sqlite3.oo1.DB(dbName, 'ct');
  }


  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(doc_id UNINDEXED, content);
    CREATE TABLE IF NOT EXISTS document_vectors (
        doc_id INTEGER PRIMARY KEY,
        embedding BLOB
    );
  `);


  console.log('Worker: Caricamento vettori in RAM...');
  const rows = db.exec({
    sql: 'SELECT doc_id, embedding FROM document_vectors',
    returnValue: 'resultRows'
  });

  for (const row of rows) {
    const id = row[0];
    const blob = row[1]; 
    const vector = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    vectorCache.set(id, vector);
  }
  console.log(`Worker: ${vectorCache.size} vettori pronti in memoria.`);

  isInitialized = true;
}

async function ingestDocument({ id, text }: { id: number, text: string }) {
  if (!db) throw new Error('DB non pronto');


  const out = await embedder(text, { pooling: 'mean', normalize: true });
  const vector = out.data as Float32Array;

  vectorCache.set(id, vector);


  db.transaction(() => {

    db.exec({
      sql: `INSERT OR REPLACE INTO document_fts(doc_id, content) VALUES (?, ?)`,
      bind: [id, text]
    });

    // Indice vettoriale (BLOB)
    db.exec({
      sql: `INSERT OR REPLACE INTO document_vectors(doc_id, embedding) VALUES (?, ?)`,
      bind: [id, vector] 
    });
  });
}

async function search(query: string) {
  if (!db || !embedder) throw new Error('Sistema non pronto');

  // 1. Vettorizza la query dell'utente
  const out = await embedder(query, { pooling: 'mean', normalize: true });
  const queryVector = out.data as Float32Array;

  const results: Array<{id: number, score: number}> = [];

  for (const [docId, docVector] of vectorCache.entries()) {
    const score = cosineSimilarity(queryVector, docVector);
    if (score > 0.25) {
      results.push({ id: docId, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

async function reindexAllDocuments(documents: Array<{id: number, text: string}>) {
    if (!db) throw new Error('DB non pronto');

    console.log(`Worker: Re-indicizzazione di ${documents.length} documenti...`);

    db.exec('DELETE FROM document_fts; DELETE FROM document_vectors;');
    vectorCache.clear();

    let count = 0;
    for (const doc of documents) {
        const content = doc.text || `Documento ${doc.id}`;
        await ingestDocument({ id: doc.id, text: content });

        count++;
        // Notifica progresso ogni 5 documenti
        if (count % 5 === 0) {
            postMessage({ type: 'REINDEX_PROGRESS', indexed: count, total: documents.length });
        }
    }
    console.log('Worker: Indicizzazione completata.');
}

// ============================================================================
// 5. UTILITÀ MATEMATICHE
// ============================================================================
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return dotProduct;
}