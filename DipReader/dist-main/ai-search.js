"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initialize = initialize;
exports.indexDocument = indexDocument;
exports.generateEmbedding = generateEmbedding;
exports.search = search;
exports.getState = getState;
// ai-search.ts - Semantic Search with Transformers.js in Electron Main Process
// Using sqlite-vss for vector storage and search (no in-memory cache needed)
const transformers_1 = require("@xenova/transformers");
const path = __importStar(require("node:path"));
const electron_1 = require("electron");
const os = __importStar(require("node:os"));
const fs = __importStar(require("node:fs"));
// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const isDev = !electron_1.app.isPackaged;
const modelsPath = isDev
    ? path.join(__dirname, 'assets', 'models')
    : path.join(process.resourcesPath, 'assets', 'models');
// Configure for Node.js native ONNX runtime
transformers_1.env.localModelPath = modelsPath;
transformers_1.env.allowLocalModels = true;
transformers_1.env.allowRemoteModels = false;
transformers_1.env.useBrowserCache = false;
// Use onnxruntime-node (native) instead of WASM
// This provides 2-5x performance improvement
transformers_1.env.backends.onnx.executionProviders = ['cpu'];
// Optimize thread usage based on CPU cores
const numThreads = Math.max(1, Math.floor(os.cpus().length / 2));
if (transformers_1.env.backends.onnx.wasm) {
    transformers_1.env.backends.onnx.wasm.numThreads = numThreads;
}
console.log('[AI Search] Models path:', modelsPath);
console.log('[AI Search] Using onnxruntime-node with', numThreads, 'threads');
// ============================================================================
// 2. STATE
// ============================================================================
let embedder = null;
let isInitialized = false;
// ============================================================================
// 4. CORE FUNCTIONS
// ============================================================================
async function initialize() {
    if (isInitialized)
        return { status: 'already_initialized' };
    console.log('[AI Search] Inizializzazione modello...');
    try {
        if (!fs.existsSync(modelsPath)) {
            console.error(`[AI Search] ERRORE GRAVE: Cartella modelli mancante: ${modelsPath}`);
        }
        embedder = await (0, transformers_1.pipeline)('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
            quantized: true,
            local_files_only: true,
        });
        isInitialized = true;
        console.log('[AI Search] Modello caricato con successo.');
        return { status: 'ok' };
    }
    catch (error) {
        console.error('[AI Search] Errore caricamento modello:', error);
        throw new Error(`Failed to load AI model: ${error.message}`);
    }
}
async function indexDocument(id, text) {
    if (!embedder)
        throw new Error('Model not initialized');
    try {
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        const vector = output.data;
        // Return the vector to Main Process for saving in sqlite-vss
        // No in-memory cache needed - sqlite-vss handles storage and indexing
        return { status: 'ok', id, vector };
    }
    catch (error) {
        console.error(`[AI Search] Error indexing document ${id}:`, error);
        throw error;
    }
}
async function generateEmbedding(text) {
    if (!embedder)
        throw new Error('Model not initialized');
    try {
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        return output.data; // Returns Float32Array
    }
    catch (error) {
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
    if (!embedder)
        throw new Error('Model not initialized');
    if (!db)
        throw new Error('Database not provided');
    console.log('[AI Search] Search query type:', typeof query, 'length:', query?.length || 0);
    let queryVector;
    try {
        if (typeof query === 'string') {
            console.log(`[AI Search] Generating embedding for query: "${query}"`);
            const output = await embedder(query, { pooling: 'mean', normalize: true });
            queryVector = output.data;
            console.log(`[AI Search] Generated query vector: ${queryVector.length} dimensions, first 3 values:`, Array.from(queryVector).slice(0, 3));
        }
        else {
            queryVector = new Float32Array(query);
            console.log(`[AI Search] Using provided vector: ${queryVector.length} dimensions`);
        }
    }
    catch (e) {
        console.error('[AI Search] Error creating embedding for query:', e);
        return [];
    }
    // Use db-handler's searchVectors method (sqlite-vss)
    const results = db.searchVectors(queryVector, limit);
    console.log(`[AI Search] Found ${results.length} results via database search`);
    if (results.length > 0) {
        console.log('[AI Search] Top 3 results:', results.slice(0, 3).map(r => `id=${r.id} score=${r.score.toFixed(4)}`));
    }
    else {
        console.warn('[AI Search] ⚠️ NO RESULTS FOUND - Check if documents are indexed');
    }
    return results;
}
function getState(db) {
    let indexedCount = 0;
    if (db) {
        try {
            const info = db.getDatabaseInfo();
            indexedCount = info.vectorCount || 0;
        }
        catch (e) {
            console.error('[AI Search] Error getting state:', e);
        }
    }
    return {
        initialized: isInitialized,
        indexedDocuments: indexedCount
    };
}
//# sourceMappingURL=ai-search.js.map