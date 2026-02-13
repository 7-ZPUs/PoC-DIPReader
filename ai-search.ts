// ai-search.ts - Semantic Search with Transformers.js in Electron Main Process
// Using sqlite-vss for vector storage and search (no in-memory cache needed)
import { pipeline, env } from '@xenova/transformers';
import * as path from 'node:path';
import { app } from 'electron';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type DatabaseHandler from './db-handler';

// ============================================================================
// 1. CONFIGURATION
// ============================================================================

const isDev = !app.isPackaged;
const modelsPath = isDev 
  ? path.join(__dirname, 'assets', 'models')
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

let embedder: any | null = null;
let isInitialized: boolean = false;

// ============================================================================
// 3. INTERFACES
// ============================================================================

interface InitializeResult {
  status: string;
}

interface IndexResult {
  status: string;
  id: string | number;
  vector: Float32Array;
}

interface SearchResult {
  id: number;
  score: number;
}

interface StateResult {
  initialized: boolean;
  indexedDocuments: number;
}

// ============================================================================
// 4. CORE FUNCTIONS
// ============================================================================

async function initialize(): Promise<InitializeResult> {
  if (isInitialized) return { status: 'already_initialized' };

  console.log('[AI Search] Inizializzazione modello...');
  try {
    if (!fs.existsSync(modelsPath)) {
      console.error(`[AI Search] ERRORE GRAVE: Cartella modelli mancante: ${modelsPath}`);
    }
    embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
      quantized: true,
      local_files_only: true,
    });
    
    isInitialized = true;
    console.log('[AI Search] Modello caricato con successo.');
    return { status: 'ok' };
  } catch (error) {
    console.error('[AI Search] Errore caricamento modello:', error);
    throw new Error(`Failed to load AI model: ${(error as Error).message}`);
  }
}

async function indexDocument(id: string | number, text: string): Promise<IndexResult> {
  if (!embedder) throw new Error('Model not initialized');

  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    const vector = output.data as Float32Array;
    
    // Return the vector to Main Process for saving in sqlite-vss
    // No in-memory cache needed - sqlite-vss handles storage and indexing
    return { status: 'ok', id, vector };
  } catch (error) {
    console.error(`[AI Search] Error indexing document ${id}:`, error);
    throw error;
  }
}

async function generateEmbedding(text: string): Promise<Float32Array> {
  if (!embedder) throw new Error('Model not initialized');
  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return output.data as Float32Array; // Returns Float32Array
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
async function search(
  db: typeof DatabaseHandler, 
  query: string | Float32Array, 
  limit: number = 10
): Promise<SearchResult[]> {
  if (!embedder) throw new Error('Model not initialized');
  if (!db) throw new Error('Database not provided');

  console.log('[AI Search] Search query type:', typeof query, 'length:', query?.length || 0);

  let queryVector: Float32Array;
  try {
    if (typeof query === 'string') {
      console.log(`[AI Search] Generating embedding for query: "${query}"`);
      const output = await embedder(query, { pooling: 'mean', normalize: true });
      queryVector = output.data as Float32Array;
      console.log(`[AI Search] Generated query vector: ${queryVector.length} dimensions, first 3 values:`, 
                  Array.from(queryVector).slice(0, 3));
    } else {
      queryVector = new Float32Array(query);
      console.log(`[AI Search] Using provided vector: ${queryVector.length} dimensions`);
    }
  } catch (e) {
    console.error('[AI Search] Error creating embedding for query:', e);
    return [];
  }

  // Use db-handler's searchVectors method (sqlite-vss)
  const results = db.searchVectors(queryVector, limit);
  console.log(`[AI Search] Found ${results.length} results via database search`);
  
  if (results.length > 0) {
    console.log('[AI Search] Top 3 results:', results.slice(0, 3).map(r => `id=${r.id} score=${r.score.toFixed(4)}`));
  } else {
    console.warn('[AI Search] ⚠️ NO RESULTS FOUND - Check if documents are indexed');
  }
  
  return results;
}

function getState(db: typeof DatabaseHandler): StateResult {
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

export {
  initialize,
  indexDocument,
  generateEmbedding,
  search,
  getState
};
