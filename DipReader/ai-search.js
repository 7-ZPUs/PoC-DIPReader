// ai-search.js - Semantic Search with Transformers.js in Electron Main Process
// Using sqlite-vss for vector storage and search (no in-memory cache needed)
const { pipeline, env } = require('@xenova/transformers');
const path = require('node:path');
const { app } = require('electron');
const os = require('node:os');

// ============================================================================
// 1. CONFIGURATION
// ============================================================================

const isDev = !app.isPackaged;
const modelsPath = isDev 
  ? path.join(__dirname, 'dist', 'DipReader', 'browser', 'assets', 'models')
  : path.join(process.resourcesPath, 'assets', 'models');

// Configure for Node.js native ONNX runtime
env.localModelPath = modelsPath;
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;

// Use onnxruntime-node (native) instead of WASM
// This provides 2-5x performance improvement
env.backends.onnx.executionProviders = ['cpu'];

// Optimize thread usage based on CPU cores
const numThreads = Math.max(1, Math.floor(os.cpus().length / 2));
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = numThreads;
}

console.log('[AI Search] Models path:', modelsPath);
console.log('[AI Search] Using onnxruntime-node with', numThreads, 'threads');

// ============================================================================
// 2. STATE
// ============================================================================

let embedder = null;
let isInitialized = false;

// ============================================================================
// 3. CORE FUNCTIONS
// ============================================================================

async function initialize() {
  if (isInitialized) return { status: 'already_initialized' };

  console.log('[AI Search] Inizializzazione modello...');
  try {
    const fs = require('node:fs');
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
    
    // Return the vector to Main Process for saving in sqlite-vss
    // No in-memory cache needed - sqlite-vss handles storage and indexing
    return { status: 'ok', id, vector };
  } catch (error) {
    console.error(`[AI Search] Error indexing document ${id}:`, error);
    throw error;
  }
}

async function generateEmbedding(text) {
  if (!embedder) throw new Error('Model not initialized');
  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return output.data; // Returns Float32Array
  } catch (error) {
    console.error('[AI Search] Error generating embedding:', error);
    throw error;
  }
}

/**
 * Search for similar documents using db-handler's searchVectors
 * @param {Object} db - Database handler instance
 * @param {string|Float32Array} query - Search query (text or embedding vector)
 * @param {number} limit - Maximum number of results
 * @returns {Array} - Array of {id, score} objects
 */
async function search(db, query, limit = 10) {
  if (!embedder) throw new Error('Model not initialized');
  if (!db) throw new Error('Database not provided');

  let queryVector;
  try {
    if (typeof query === 'string') {
      const output = await embedder(query, { pooling: 'mean', normalize: true });
      queryVector = output.data;
    } else {
      queryVector = new Float32Array(query);
    }
  } catch (e) {
    console.error('[AI Search] Error creating embedding for query:', e);
    return [];
  }

  // Use db-handler's searchVectors method (sqlite-vss)
  const results = db.searchVectors(queryVector, limit);
  console.log(`[AI Search] Found ${results.length} results via sqlite-vss`);
  
  return results;
}

function getState(db) {
  let indexedCount = 0;
  if (db) {
    try {
      const info = db.getDatabaseInfo();
      indexedCount = info.vectorCount || 0;
    } catch (e) {
      console.error('[AI Search] Error getting state:', e);
    }
  }
  
  return {
    initialized: isInitialized,
    indexedDocuments: indexedCount
  };
}

module.exports = {
  initialize,
  indexDocument,
  generateEmbedding,
  search,
  getState
};