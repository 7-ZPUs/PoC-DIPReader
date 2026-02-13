import type DatabaseHandler from './db-handler';
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
declare function initialize(): Promise<InitializeResult>;
declare function indexDocument(id: string | number, text: string): Promise<IndexResult>;
declare function generateEmbedding(text: string): Promise<Float32Array>;
/**
 * Search for similar documents using db-handler's searchVectors
 * @param {Object} db - Database handler instance
 * @param {string|Float32Array} query - Search query (text or embedding vector)
 * @param {number} limit - Maximum number of results
 * @returns {Array} - Array of {id, score} objects
 */
declare function search(db: typeof DatabaseHandler, query: string | Float32Array, limit?: number): Promise<SearchResult[]>;
declare function getState(db: typeof DatabaseHandler): StateResult;
export { initialize, indexDocument, generateEmbedding, search, getState };
//# sourceMappingURL=ai-search.d.ts.map