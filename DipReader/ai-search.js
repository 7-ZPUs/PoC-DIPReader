// ai-search.js - Semantic Search with Transformers.js in Electron Main Process
const { pipeline, env } = require('@xenova/transformers');
const path = require('path');
const { app } = require('electron');

// ============================================================================
// 1. CONFIGURATION
// ============================================================================

const isDev = !app.isPackaged;
const modelsPath = isDev 
  ? path.join(__dirname, 'dist', 'DipReader', 'browser', 'assets', 'models')
  : path.join(process.resourcesPath, 'assets', 'models');

const onnxWasmPath = isDev
  ? path.join(__dirname, 'dist', 'DipReader', 'browser', 'assets', 'onnx-wasm')
  : path.join(process.resourcesPath, 'assets', 'onnx-wasm');

env.localModelPath = modelsPath;
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = onnxWasmPath;
env.backends.onnx.wasm.numThreads = 4;

console.log('[AI Search] Models path:', modelsPath);

// ============================================================================
// 2. STATE
// ============================================================================

let embedder = null;
let isInitialized = false;
// Vector cache: Document ID -> Float32Array
const vectorCache = new Map();

// ============================================================================
// 3. CORE FUNCTIONS
// ============================================================================

async function initialize() {
  if (isInitialized) return { status: 'already_initialized' };

  console.log('[AI Search] Inizializzazione modello...');
  try {
    const fs = require('fs');
    if (!fs.existsSync(modelsPath)) {
        console.error(`[AI Search] ERRORE GRAVE: Cartella modelli mancante: ${modelsPath}`);
    }
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
      local_files_only: true,
    });
    
    isInitialized = true;
    console.log('[AI Search] Modello caricato con successo.');
    return { status: 'ok' };
  } catch (error) {
    console.error('[AI Search] Errore caricamento modello:', error);
    throw new Error(`Failed to load AI model: ${error.message}`);
  }
}

async function indexDocument(id, text) {
  if (!embedder) throw new Error('Model not initialized');

  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    const vector = output.data;
    
    // 1. Salva in memoria RAM (Fondamentale per la ricerca immediata)
    vectorCache.set(id, vector);
    
    // 2. Ritorna il vettore al Main Process per il salvataggio su DB
    return { status: 'ok', id, vector };
  } catch (error) {
    console.error(`[AI Search] Error indexing document ${id}:`, error);
    throw error;
  }
}

function loadVectors(vectorsList) {
    if (!vectorsList || !Array.isArray(vectorsList)) return { count: 0 };

    let count = 0;
    for (const item of vectorsList) {
        if (item.id && item.vector) {
            // Conversione sicura in Float32Array
            const vec = item.vector instanceof Float32Array 
                ? item.vector 
                : new Float32Array(item.vector);
            
            vectorCache.set(item.id, vec);
            count++;
        }
    }
    console.log(`[AI Search] MEMORIA RIPOPOLATA: ${count} vettori caricati dal DB. Totale: ${vectorCache.size}`);
    return { count };
}

async function generateEmbedding(text) {
  if (!embedder) throw new Error('Model not initialized');
  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return output.data; // Ritorna Float32Array
  } catch (error) {
    console.error('[AI Search] Error generating embedding:', error);
    throw error;
  }
}

async function search(query) {
  if (!embedder) throw new Error('Model not initialized');

  // --- DEBUG CRITICO: Controlla se la memoria è vuota ---
  console.log(`[AI Search] Richiesta ricerca. Documenti in memoria: ${vectorCache.size}`);
  
  if (vectorCache.size === 0) {
      console.warn('[AI Search] ATTENZIONE: La memoria AI è vuota! Nessun risultato possibile.');
      return [];
  }
  // ------------------------------------------------------

  let queryVector;
  try {
      if (typeof query === 'string') {
        const output = await embedder(query, { pooling: 'mean', normalize: true });
        queryVector = output.data;
      } else {
        queryVector = new Float32Array(query);
      }
  } catch (e) {
      console.error('[AI Search] Errore creazione embedding query:', e);
      return [];
  }

  const results = [];
  for (const [docId, docVector] of vectorCache.entries()) {
    const score = cosineSimilarity(queryVector, docVector);
    if (score > 0.25) { 
      results.push({ id: docId, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  console.log(`[AI Search] Trovati ${results.length} risultati.`);
  
  return results.slice(0, 20);
}

async function reindexAll(documents) {
  if (!embedder) throw new Error('Model not initialized');

  console.log(`[AI Search] Reindexing ${documents.length} documents...`);
  
  // Pulisce la cache RAM prima di iniziare
  vectorCache.clear();

  let indexed = 0;
  const logInterval = Math.max(50, Math.floor(documents.length / 10));
  for (const doc of documents) {
    // Nota: indexDocument aggiorna automaticamente la vectorCache
    const text = doc.text || `Document ${doc.id}`;
    await indexDocument(doc.id, text);
    indexed++;
    
    if (indexed % logInterval === 0) {
      console.log(`[AI Search] Progress: ${indexed}/${documents.length}`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  console.log(`[AI Search] Reindexing complete: ${indexed} documents in memory.`);
  return { status: 'ok', indexed };
}

function getState() {
  return {
    initialized: isInitialized,
    indexedDocuments: vectorCache.size
  };
}

function clearIndex() {
  vectorCache.clear();
  console.log('[AI Search] Index cleared');
  return { status: 'ok' };
}

function cosineSimilarity(a, b) {
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return dotProduct;
}

module.exports = {
  initialize,
  indexDocument,
  generateEmbedding,
  search,
  reindexAll,
  getState,
  clearIndex,
  loadVectors // Esportato correttamente
};