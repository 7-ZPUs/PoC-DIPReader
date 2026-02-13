import Database from 'better-sqlite3';
interface DatabaseInfo {
    open: boolean;
    dipUUID?: string;
    fileCount?: number;
    documentCount?: number;
    vectorCount?: number;
    vssEnabled?: boolean;
    error?: string;
}
interface OpenDatabaseResult {
    success: boolean;
    dipUUID: string;
    existed: boolean;
}
declare class DatabaseHandler {
    private db;
    private currentDipUUID;
    private dbPath;
    private vssEnabled;
    /**
     * Initialize database path - must be called after Electron app is ready
     */
    private _ensureDbPath;
    /**
     * Open or create a database for a specific DIP
     */
    openOrCreateDatabase(dipUUID: string): Promise<OpenDatabaseResult>;
    /**
     * Create database schema from schema.sql file
     * schema.sql is in the root directory alongside other Node.js files (main.js, db-handler.js)
     */
    createSchema(): void;
    saveVector(docId: number, vector: Float32Array): void;
    getAllVectors(): Array<{
        id: number;
    }>;
    /**
     * Search for similar vectors using sqlite-vss (or fallback to brute-force)
     */
    searchVectors(queryVector: Float32Array, limit?: number): Array<{
        id: number;
        score: number;
    }>;
    /**
     * Clear all tables for re-indexing
     */
    clearTables(): {
        success: boolean;
    };
    /**
     * Execute a SQL query
     */
    executeQuery(sql: string, params?: any[]): any;
    /**
     * Execute SQL without returning results (for INSERT, UPDATE, DELETE)
     */
    exec(sql: string, params?: any[]): Database.RunResult;
    /**
     * List all available databases
     */
    listDatabases(): string[];
    /**
     * Delete a database
     */
    deleteDatabase(dipUUID: string): {
        success: boolean;
        error?: string;
    };
    /**
     * Export database to a file
     */
    exportDatabase(exportPath?: string): {
        success: boolean;
        path?: string;
        error?: string;
    };
    /**
     * Get current database info
     */
    getDatabaseInfo(): DatabaseInfo;
    /**
     * Close current database
     */
    close(): void;
}
declare const _default: DatabaseHandler;
export default _default;
//# sourceMappingURL=db-handler.d.ts.map