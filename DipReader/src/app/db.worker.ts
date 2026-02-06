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
    // Forza il fallback immediatamente senza provare OpfsDb
}
  if (isInitialized) return;
  console.log('Worker: Avvio sistema Semantic Search (Mode: BLOB+JS)...');

  // A. Caricamento AI
  // Assicurati che la cartella /assets/models/nomic-ai/v1.5-fixed esista!
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
  });
  console.log('Worker: AI caricata.');

  // B. Caricamento SQLite
  const sqlite3 = await (sqlite3InitModule as any)({ 
    print: console.log, 
    printErr: console.error 
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
    console.warn('Worker: Fallback in memoria (File bloccato o non supportato).');
    db = new sqlite3.oo1.DB(dbName, 'ct');
  }

  // C. Creazione Tabelle (Standard SQL, NIENTE vec0)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(doc_id UNINDEXED, content);
    CREATE TABLE IF NOT EXISTS document_vectors (
        doc_id INTEGER PRIMARY KEY, 
        embedding BLOB
    );
  `);

  // D. Idratazione Cache (Carica i vettori dal disco alla RAM)
  console.log('Worker: Caricamento vettori in RAM...');
  const rows = db.exec({
    sql: 'SELECT doc_id, embedding FROM document_vectors',
    returnValue: 'resultRows'
  });
  
  for (const row of rows) {
    const id = row[0];
    const blob = row[1]; // Questo arriva come Uint8Array
    // Converti i byte grezzi in array di numeri Float32
    const vector = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    vectorCache.set(id, vector);
  }
  console.log(`Worker: ${vectorCache.size} vettori pronti in memoria.`);

  isInitialized = true;
}

async function ingestDocument({ id, text }: { id: number, text: string }) {
  if (!db) throw new Error('DB non pronto');

  // 1. Crea Embedding
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  const vector = out.data as Float32Array; 

  // 2. Salva in Cache RAM (per ricerca veloce)
  vectorCache.set(id, vector);

  // 3. Salva su Disco (come BLOB standard)
  db.transaction(() => {
    // Indice testuale
    db.exec({ 
      sql: `INSERT OR REPLACE INTO document_fts(doc_id, content) VALUES (?, ?)`, 
      bind: [id, text] 
    });
    
    // Indice vettoriale (BLOB)
    db.exec({ 
      sql: `INSERT OR REPLACE INTO document_vectors(doc_id, embedding) VALUES (?, ?)`, 
      bind: [id, vector] // SQLite WASM salva automaticamente il TypedArray come BLOB
    });
  });
}

async function search(query: string) {
  if (!db || !embedder) throw new Error('Sistema non pronto');

  // 1. Vettorizza la query dell'utente
  const out = await embedder(query, { pooling: 'mean', normalize: true });
  const queryVector = out.data as Float32Array;

  // 2. Calcola Similarità (Cosine Similarity) in JS puro
  // Iteriamo sulla cache in memoria invece di fare una query SQL complessa
  const results: Array<{id: number, score: number}> = [];

  for (const [docId, docVector] of vectorCache.entries()) {
    const score = cosineSimilarity(queryVector, docVector);
    // Filtro soglia (es. 0.25) per scartare risultati irrilevanti
    if (score > 0.25) { 
      results.push({ id: docId, score });
    }
  }

  // 3. Ordina per punteggio (dal più alto al più basso) e prendi i primi 20
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

async function reindexAllDocuments(documents: Array<{id: number, text: string}>) {
    if (!db) throw new Error('DB non pronto');
    
    console.log(`Worker: Re-indicizzazione di ${documents.length} documenti...`);
    
    // Pulisci tutto per ripartire da zero
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
  // Prodotto scalare (Dot Product)
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  // Poiché i vettori sono già normalizzati dall'AI (normalize: true),
  // il prodotto scalare È la cosine similarity. Non serve dividere per le magnitudini.
  return dotProduct;
}