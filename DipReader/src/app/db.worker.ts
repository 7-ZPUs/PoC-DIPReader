/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { pipeline, env } from '@xenova/transformers';

// ============================================================================
// CONFIGURAZIONE
// ============================================================================
env.localModelPath = '/assets/models/';
env.allowLocalModels = true;   // Prova prima i modelli locali
env.allowRemoteModels = true;  // Se falliscono, scarica da Hugging Face
env.useBrowserCache = false;   // Evita cache corrotta

// Configurazione ONNX per migliore compatibilità
env.backends = env.backends || {};
env.backends.onnx = env.backends.onnx || {};
env.backends.onnx.wasm = env.backends.onnx.wasm || {};
env.backends.onnx.wasm.numThreads = 1;

// ============================================================================
// STATE
// ============================================================================
let db: any = null;
let embedder: any = null;
let isInitializing = false;
let isInitialized = false;

// ============================================================================
// MESSAGE HANDLER
// ============================================================================
addEventListener('message', async ({ data }) => {
  try {
    switch (data.type) {
      case 'INIT':
        if (isInitializing) {
          console.warn('Worker: Inizializzazione già in corso, ignoro duplicato');
          return;
        }
        if (isInitialized) {
          console.log('Worker: Già inizializzato');
          postMessage({ type: 'INIT_RESULT', status: 'already_initialized' });
          return;
        }
        
        isInitializing = true;
        await initSystem(data.payload);
        isInitializing = false;
        isInitialized = true;
        postMessage({ type: 'INIT_RESULT', status: 'ok' });
        break;
        
      case 'INDEX_METADATA':
        if (!isInitialized) {
          throw new Error('Worker non inizializzato');
        }
        await ingestDocument(data.payload);
        postMessage({ type: 'INDEX_RESULT', status: 'ok', id: data.payload.id });
        break;
        
      case 'SEARCH':
        if (!isInitialized) {
          throw new Error('Worker non inizializzato');
        }
        const results = await search(data.payload.query);
        postMessage({ type: 'SEARCH_RESULT', results });
        break;
        
      case 'REINDEX_ALL':
        if (!isInitialized) {
          throw new Error('Worker non inizializzato');
        }
        if (!data.payload || !data.payload.documents) {
          throw new Error('Dati documenti mancanti nel payload');
        }
        await reindexAllDocuments(data.payload.documents);
        postMessage({ type: 'REINDEX_COMPLETE', status: 'ok' });
        break;
        
      default:
        console.warn('Worker: Tipo messaggio sconosciuto:', data.type);
    }
  } catch (err: any) {
    console.error('Worker Error:', err);
    isInitializing = false; // Reset flag in caso di errore
    postMessage({ 
      type: 'ERROR', 
      error: { message: err.message, stack: err.stack },
      originalType: data.type
    });
  }
});

// ============================================================================
// INITIALIZATION
// ============================================================================
async function initSystem(config: { wasmUrl: string }) {
  console.log('========================================');
  console.log('Worker: Avvio inizializzazione sistema');
  console.log('========================================');

  try {
    // STEP 1: SQLite
    console.log('Worker: [1/2] Inizializzazione SQLite...');
    await initSQLite();
    console.log('Worker: ✓ SQLite pronto');

    // STEP 2: AI Model
    console.log('Worker: [2/2] Caricamento modello AI...');
    await initAIModel();
    console.log('Worker: ✓ Modello AI caricato');

    console.log('========================================');
    console.log('Worker: ✓ Sistema pronto!');
    console.log('========================================');
    
  } catch (err: any) {
    console.error('========================================');
    console.error('Worker: ✗ ERRORE INIZIALIZZAZIONE');
    console.error('========================================');
    console.error(err);
    throw err;
  }
}

async function initSQLite() {
  const sqlite3 = await sqlite3InitModule({ 
    print: console.log, 
    printErr: console.error 
  });

  if ('opfs' in sqlite3) {
    db = new sqlite3.oo1.OpfsDb('/archival-semantic.sqlite3');
    console.log('Worker: DB OPFS aperto (persistente)');
  } else {
    db = new sqlite3.oo1.DB('/archival-semantic.sqlite3', 'ct');
    console.warn('Worker: DB in memoria (non persistente)');
  }

  // Crea tabelle per ricerca semantica
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts 
    USING fts5(doc_id UNINDEXED, content);
    
    CREATE VIRTUAL TABLE IF NOT EXISTS document_vec 
    USING vec0(doc_id INTEGER PRIMARY KEY, embedding float[768]);
  `);
  
  console.log('Worker: Tabelle vettoriali create');
}

async function initAIModel() {
  const modelName = 'nomic-ai/v1.5-fixed';
  
  console.log(`Worker: Caricamento modello: ${modelName}`);
  console.log(`Worker: - Path locale: ${env.localModelPath}`);
  console.log(`Worker: - Modelli locali: ${env.allowLocalModels}`);
  console.log(`Worker: - Modelli remoti: ${env.allowRemoteModels}`);
  console.log(`Worker: - Cache browser: ${env.useBrowserCache}`);
  
  try {
    embedder = await pipeline('feature-extraction', modelName, {
      quantized: true,
      progress_callback: (progress: any) => {
        if (progress.status === 'progress') {
          const percent = Math.round(progress.progress || 0);
          console.log(`Worker: Download ${progress.file}: ${percent}%`);
        } else if (progress.status === 'done') {
          console.log(`Worker: ✓ ${progress.file} caricato`);
        } else if (progress.status === 'initiate') {
          console.log(`Worker: Inizio download ${progress.file}...`);
        }
      }
    });
    
    // Test di verifica
    console.log('Worker: Test embedding...');
    const testResult = await embedder('test', { 
      pooling: 'mean', 
      normalize: true 
    });
    
    if (!testResult || !testResult.data || testResult.data.length === 0) {
      throw new Error('Modello non produce output valido');
    }
    
    console.log(`Worker: ✓ Test OK (dimensione: ${testResult.data.length})`);
    
  } catch (err: any) {
    console.error('Worker: ERRORE caricamento modello:', err.message);
    
    // Diagnostica dettagliata
    if (err.message.includes('protobuf') || err.message.includes('parsing')) {
      console.error('');
      console.error('═══════════════════════════════════════════════════════');
      console.error('PROBLEMA: File del modello corrotti o incompatibili');
      console.error('═══════════════════════════════════════════════════════');
      console.error('');
      console.error('SOLUZIONI POSSIBILI:');
      console.error('');
      console.error('1. Elimina la cache del browser:');
      console.error('   - Apri DevTools (F12)');
      console.error('   - Application → Storage → Clear site data');
      console.error('');
      console.error('2. Verifica i file del modello in:');
      console.error('   /assets/models/nomic-ai/v1.5-fixed/');
      console.error('   Devono esserci:');
      console.error('   - config.json');
      console.error('   - tokenizer.json');
      console.error('   - onnx/model_quantized.onnx');
      console.error('');
      console.error('3. Oppure usa un modello più piccolo per test:');
      console.error('   Cambia "nomic-ai/v1.5-fixed" con');
      console.error('   "Xenova/all-MiniLM-L6-v2"');
      console.error('   (si scarica automaticamente, ~25MB)');
      console.error('');
      console.error('═══════════════════════════════════════════════════════');
      
    } else if (err.message.includes('session') || err.message.includes('WASM')) {
      console.error('');
      console.error('═══════════════════════════════════════════════════════');
      console.error('PROBLEMA: ONNX Runtime / WebAssembly');
      console.error('═══════════════════════════════════════════════════════');
      console.error('');
      console.error('SOLUZIONI:');
      console.error('1. Usa Chrome o Edge (migliore supporto WASM)');
      console.error('2. Verifica che WASM sia abilitato nel browser');
      console.error('3. Disabilita estensioni del browser');
      console.error('');
      console.error('═══════════════════════════════════════════════════════');
    }
    
    throw new Error(`Impossibile caricare modello AI: ${err.message}`);
  }
}

// ============================================================================
// DOCUMENT OPERATIONS
// ============================================================================
async function ingestDocument({ id, text }: { id: number, text: string }) {
  if (!db || !embedder) {
    throw new Error('Sistema non completamente inizializzato');
  }
  
  try {
    // Limita lunghezza testo (max ~2000 caratteri)
    const maxLength = 2000;
    const truncatedText = text.length > maxLength 
      ? text.substring(0, maxLength) + '...' 
      : text;
    
    // Genera embedding
    const out = await embedder(truncatedText, { 
      pooling: 'mean', 
      normalize: true 
    });
    
    const vector = Array.from(out.data);

    // Verifica dimensione
    if (vector.length !== 768) {
      throw new Error(`Dimensione embedding errata: ${vector.length} (atteso: 768)`);
    }

    // Salva in transazione
    db.exec(`BEGIN TRANSACTION`);
    
    try {
      db.exec({ 
        sql: `INSERT OR REPLACE INTO document_fts(doc_id, content) VALUES (?, ?)`, 
        bind: [id, truncatedText] 
      });
      
      db.exec({ 
        sql: `INSERT OR REPLACE INTO document_vec(doc_id, embedding) VALUES (?, ?)`, 
        bind: [id, vector] 
      });
      
      db.exec(`COMMIT`);
      
    } catch (dbErr) {
      db.exec(`ROLLBACK`);
      throw dbErr;
    }
    
  } catch (err: any) {
    console.error(`Worker: Errore indicizzazione doc ${id}:`, err.message);
    throw err;
  }
}

async function search(query: string) {
  if (!db || !embedder) {
    throw new Error('Sistema non completamente inizializzato');
  }
  
  try {
    // Genera embedding query
    const out = await embedder(query, { 
      pooling: 'mean', 
      normalize: true 
    });
    
    const vector = Array.from(out.data);
    
    if (vector.length !== 768) {
      throw new Error(`Dimensione embedding query errata: ${vector.length}`);
    }
    
    const results: any[] = [];
    
    // Ricerca vettoriale
    db.exec({
      sql: `
        SELECT doc_id, vec_distance_cosine(embedding, ?) as distance 
        FROM document_vec 
        ORDER BY distance ASC 
        LIMIT 20
      `,
      bind: [vector],
      callback: (row: any) => {
        results.push({ 
          id: row[0], 
          score: 1 - row[1] // Converti distanza in similarità
        });
      }
    });
    
    return results;
    
  } catch (err: any) {
    console.error('Worker: Errore ricerca:', err.message);
    throw err;
  }
}

async function reindexAllDocuments(documents: Array<{id: number, text: string}>) {
  if (!db || !embedder) {
    throw new Error('Sistema non completamente inizializzato');
  }
  
  console.log(`Worker: Ricevuti ${documents.length} documenti per re-indicizzazione`);
  
  // Pulisci indici esistenti
  try {
    db.exec(`DELETE FROM document_fts`);
    db.exec(`DELETE FROM document_vec`);
    console.log('Worker: Indici precedenti eliminati');
  } catch (err) {
    console.warn('Worker: Impossibile eliminare indici (potrebbero non esistere)');
  }
  
  // Indicizza documenti
  let count = 0;
  let failed = 0;
  const startTime = Date.now();
  
  for (const doc of documents) {
    try {
      const content = doc.text || `Documento ${doc.id}`;
      await ingestDocument({ id: doc.id, text: content });
      count++;
      
      // Progress ogni 5 documenti
      if (count % 5 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = count / elapsed;
        console.log(
          `Worker: Indicizzati ${count}/${documents.length} ` +
          `(${Math.round(rate * 10) / 10} doc/s)`
        );
      }
      
    } catch (err) {
      console.error(`Worker: Errore indicizzazione doc ${doc.id}:`, err);
      failed++;
    }
  }
  
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log(`Worker: ✓ Re-indicizzazione completata in ${totalTime}s`);
  console.log(`Worker: Successi: ${count}, Falliti: ${failed}`);
}

// ============================================================================
// ERROR HANDLERS
// ============================================================================
addEventListener('error', (event) => {
  console.error('Worker: Errore non gestito:', event);
  postMessage({ 
    type: 'ERROR', 
    error: { message: 'Errore non gestito', details: event.message }
  });
});

addEventListener('unhandledrejection', (event) => {
  console.error('Worker: Promise rejection:', event.reason);
  postMessage({ 
    type: 'ERROR', 
    error: { message: 'Promise rejection', details: event.reason }
  });
});

console.log('Worker: Script caricato, in attesa di INIT...');