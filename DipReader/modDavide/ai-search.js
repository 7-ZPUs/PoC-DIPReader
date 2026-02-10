// ai-search.js - Semantic Search with Transformers.js in Electron Main Process
const { pipeline, env } = require('@xenova/transformers');
const path = require('path');
const { app } = require('electron');

// ============================================================================
// 1. CONFIGURATION
// ============================================================================

// Configure transformers to use local models
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
env.backends.onnx.wasm.numThreads = 4; // Use more threads in Node.js

console.log('[AI Search] Models path:', modelsPath);
console.log('[AI Search] ONNX WASM path:', onnxWasmPath);

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

/**
 * Initialize the AI model
 */
async function initialize() {
  if (isInitialized) {
    return { status: 'already_initialized' };
  }

  console.log('[AI Search] Loading model...');
  
  try {
    embedder = await pipeline(
      'feature-extraction', 
      'Xenova/all-MiniLM-L6-v2',
      {
        quantized: true,
        local_files_only: true,
      }
    );
    
    isInitialized = true;
    console.log('[AI Search] Model loaded successfully');
    return { status: 'ok' };
  } catch (error) {
    console.error('[AI Search] Model loading failed:', error);
    throw new Error(`Failed to load AI model: ${error.message}`);
  }
}

/**
 * Index a single document
 */
async function indexDocument(id, text) {
  if (!embedder) {
    throw new Error('Model not initialized');
  }

  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    const vector = output.data;
    
    // Store in cache
    vectorCache.set(id, vector);
    
    console.log(`[AI Search] Indexed document ${id} (vector size: ${vector.length})`);
    return { status: 'ok', id };
  } catch (error) {
    console.error(`[AI Search] Error indexing document ${id}:`, error);
    throw error;
  }
}

/**
 * Generate embedding for text
 */
async function generateEmbedding(text) {
  if (!embedder) {
    throw new Error('Model not initialized');
  }

  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    // Convert Float32Array to regular array for IPC transmission
    return output.data;
  } catch (error) {
    console.error('[AI Search] Error generating embedding:', error);
    throw error;
  }
}

/**
 * Search similar documents
 */
async function search(query) {
  if (!embedder) {
    throw new Error('Model not initialized');
  }

  let queryVector;

  // Generate query vector if query is a string
  if (typeof query === 'string') {
    const output = await embedder(query, { pooling: 'mean', normalize: true });
    queryVector = output.data;
  } else {
    // Query is already a vector (array)
    queryVector = new Float32Array(query);
  }

  const results = [];

  // Calculate cosine similarity with all cached vectors
  for (const [docId, docVector] of vectorCache.entries()) {
    const score = cosineSimilarity(queryVector, docVector);
    if (score > 0.25) { // Threshold for relevance
      results.push({ id: docId, score });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  console.log(`[AI Search] Found ${results.length} results for query`);
  
  // Return top 20 results
  return results.slice(0, 20);
}

/**
 * Reindex all documents
 */
async function reindexAll(documents) {
  if (!embedder) {
    throw new Error('Model not initialized');
  }

  console.log(`[AI Search] Reindexing ${documents.length} documents...`);
  
  // Clear existing cache
  vectorCache.clear();

  let indexed = 0;
  for (const doc of documents) {
    const text = doc.text || `Document ${doc.id}`;
    await indexDocument(doc.id, text);
    indexed++;
    
    // Log progress every 10 documents
    if (indexed % 10 === 0) {
      console.log(`[AI Search] Progress: ${indexed}/${documents.length}`);
    }
  }

  console.log(`[AI Search] Reindexing complete: ${indexed} documents`);
  return { status: 'ok', indexed };
}

/**
 * Get current state
 */
function getState() {
  return {
    initialized: isInitialized,
    indexedDocuments: vectorCache.size
  };
}

/**
 * Clear all indexed documents
 */
function clearIndex() {
  vectorCache.clear();
  console.log('[AI Search] Index cleared');
  return { status: 'ok' };
}

// ============================================================================
// 4. UTILITY FUNCTIONS
// ============================================================================

/**
 * Cosine similarity between two vectors
 * Assumes vectors are already normalized
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return dotProduct;
}

// ============================================================================
// 5. EXPORTS
// ============================================================================

module.exports = {
  initialize,
  indexDocument,
  generateEmbedding,
  search,
  reindexAll,
  getState,
  clearIndex
};
