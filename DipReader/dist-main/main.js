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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
const db_handler_1 = __importDefault(require("./db-handler"));
const indexer_main_1 = __importDefault(require("./indexer-main"));
const aiSearch = __importStar(require("./ai-search"));
// 1. Registra il protocollo come "Secure" PRIMA che l'app sia ready
electron_1.protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);
function createWindow() {
    const mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    // 2. Gestisci la richiesta dei file e inietta gli header COOP/COEP
    electron_1.protocol.handle('app', async (request) => {
        const url = new URL(request.url);
        // Prende solo il percorso (es. /index.html) ignorando l'hostname 'localhost'
        let relativePath = url.pathname;
        // Se il path è vuoto o root, punta a index.html
        if (relativePath === '/' || relativePath === '') {
            relativePath = 'index.html';
        }
        // Costruisci il path assoluto (assicurati che il path alla dist sia corretto)
        const filePath = path.join(electron_1.app.getAppPath(), 'dist/DipReader/browser', relativePath);
        try {
            const data = fs.readFileSync(filePath);
            return new Response(data, {
                headers: {
                    'Content-Type': getContentType(filePath),
                    'Cross-Origin-Opener-Policy': 'same-origin',
                    'Cross-Origin-Embedder-Policy': 'require-corp'
                }
            });
        }
        catch (e) {
            console.error(`[Protocol] Errore nel caricamento di ${filePath}:`, e);
            // Ritorna un 404 invece di crashare il protocollo
            return new Response('File non trovato', { status: 404 });
        }
    });
    mainWindow.loadURL('app://localhost');
}
// Funzione helper per i MIME types
function getContentType(filePath) {
    const ext = path.extname(filePath);
    if (ext === '.js')
        return 'text/javascript';
    if (ext === '.wasm')
        return 'application/wasm';
    if (ext === '.html')
        return 'text/html';
    if (ext === '.css')
        return 'text/css';
    return 'application/octet-stream';
}
// ============================================
// Helper Functions
// ============================================
/**
 * Generate semantic embeddings for all documents in the database
 * @param {Object} db - Database handler instance
 */
async function generateSemanticEmbeddings(db) {
    console.log('[Semantic] Starting semantic indexing...');
    try {
        // Initialize AI model if not already initialized
        await aiSearch.initialize();
        // Query to get all documents with their metadata
        // Include ALL metadata for better semantic search (not just CategoriaProdotto)
        const docs = db.executeQuery(`
            SELECT 
                d.id,
                d.root_path as name,
                GROUP_CONCAT(m.meta_value, ' ') as combined_text
            FROM document d
            LEFT JOIN metadata m ON d.id = m.document_id
            WHERE m.meta_type = 'string' AND m.file_id IS NULL AND m.meta_key = 'CategoriaProdotto'
            GROUP BY d.id
        `);
        console.log(`[Semantic] Processing ${docs.length} documents with CategoriaProdotto metadata`);
        if (docs.length > 0) {
            console.log(`[Semantic] First 3 docs to index:`, docs.slice(0, 3).map((d) => `ID=${d.id}, name=${d.name}, text="${d.combined_text}"`));
        }
        let indexed = 0;
        for (const doc of docs) {
            // Combine document name and metadata into searchable text
            const text = [
                doc.name || 'Untitled',
                doc.combined_text || ''
            ].filter(Boolean).join(' ').trim();
            if (text) {
                try {
                    // Generate embedding vector
                    const result = await aiSearch.indexDocument(doc.id, text);
                    // Save vector to database (sqlite-vss or fallback BLOB)
                    db.saveVector(doc.id, result.vector);
                    indexed++;
                    // Log first few and every 100th document
                    if (indexed <= 3 || indexed % 100 === 0) {
                        console.log(`[Semantic] Indexed doc ${doc.id} (${indexed}/${docs.length}): "${text.substring(0, 60)}..."`);
                    }
                }
                catch (error) {
                    console.error(`[Semantic] Error indexing document ${doc.id}:`, error);
                }
            }
        }
        console.log(`[Semantic] Semantic indexing completed: ${indexed}/${docs.length} documents indexed`);
        return { success: true, indexed, total: docs.length };
    }
    catch (error) {
        console.error('[Semantic] Error during semantic indexing:', error);
        throw error;
    }
}
// ============================================
// IPC Handlers for Database Operations
// ============================================
// Initialize database
electron_1.ipcMain.handle('db:init', async () => {
    try {
        console.log('[IPC] Database initialization requested');
        return { status: 'success' };
    }
    catch (err) {
        console.error('[IPC] Database initialization error:', err);
        return { status: 'error', error: err.message };
    }
});
// Open or create a database for a DIP
electron_1.ipcMain.handle('db:open', async (_event, dipUUID) => {
    try {
        console.log('[IPC] Opening database for DIP:', dipUUID);
        const result = await db_handler_1.default.openOrCreateDatabase(dipUUID);
        // Initialize AI model if vectors exist
        if (result.success) {
            const vectors = db_handler_1.default.getAllVectors();
            if (vectors.length > 0) {
                console.log(`[IPC] Database has ${vectors.length} vectors indexed`);
                await aiSearch.initialize();
            }
        }
        return result;
    }
    catch (err) {
        console.error('[IPC] Error opening database:', err);
        throw err;
    }
});
// Select DIP directory
electron_1.ipcMain.handle('dip:select-directory', async () => {
    try {
        const result = await electron_1.dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select DIP Directory'
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { canceled: true };
        }
        return {
            canceled: false,
            path: result.filePaths[0]
        };
    }
    catch (err) {
        console.error('[IPC] Error selecting directory:', err);
        throw err;
    }
});
// Index a DIP
electron_1.ipcMain.handle('db:index', async (_event, dipUUID, dipPath) => {
    try {
        console.log('[IPC] Indexing DIP:', dipUUID, 'at path:', dipPath);
        // Open or create database
        await db_handler_1.default.openOrCreateDatabase(dipUUID);
        // Check if database has data (for re-indexing)
        const info = db_handler_1.default.getDatabaseInfo();
        if (info.fileCount && info.fileCount > 0) {
            console.log('[IPC] Database has existing data, clearing tables...');
            db_handler_1.default.clearTables();
        }
        // Run structural indexer (XML → SQLite)
        const indexer = new indexer_main_1.default(db_handler_1.default, dipPath);
        await indexer.indexDip();
        console.log('[IPC] Structural indexing completed, starting semantic indexing...');
        // Run semantic indexing (SQLite → Vector embeddings)
        const semanticResult = await generateSemanticEmbeddings(db_handler_1.default);
        console.log('[IPC] Indexing completed successfully');
        console.log(`[IPC] Total: ${semanticResult.indexed} documents indexed semantically`);
        return {
            success: true,
            dipUUID,
            semanticIndexed: semanticResult.indexed,
            semanticTotal: semanticResult.total
        };
    }
    catch (err) {
        console.error('[IPC] Indexing error:', err);
        throw err;
    }
});
// Execute a query
electron_1.ipcMain.handle('db:query', async (_event, sql, params = []) => {
    try {
        const result = db_handler_1.default.executeQuery(sql, params);
        return result;
    }
    catch (err) {
        console.error('[IPC] Query error:', err);
        throw err;
    }
});
// List all databases
electron_1.ipcMain.handle('db:list', async () => {
    try {
        const databases = db_handler_1.default.listDatabases();
        return databases;
    }
    catch (err) {
        console.error('[IPC] Error listing databases:', err);
        throw err;
    }
});
// Delete a database
electron_1.ipcMain.handle('db:delete', async (_event, dipUUID) => {
    try {
        console.log('[IPC] Deleting database:', dipUUID);
        const result = db_handler_1.default.deleteDatabase(dipUUID);
        return result;
    }
    catch (err) {
        console.error('[IPC] Error deleting database:', err);
        throw err;
    }
});
// Export database
electron_1.ipcMain.handle('db:export', async (_event, exportPath) => {
    try {
        let targetPath = exportPath;
        if (!targetPath) {
            const result = await electron_1.dialog.showSaveDialog({
                title: 'Export Database',
                defaultPath: `${db_handler_1.default.currentDipUUID || 'dip'}.sqlite3`,
                filters: [
                    { name: 'SQLite Database', extensions: ['sqlite3', 'db'] }
                ]
            });
            if (result.canceled) {
                return { canceled: true };
            }
            targetPath = result.filePath;
        }
        const exportResult = db_handler_1.default.exportDatabase(targetPath);
        return exportResult;
    }
    catch (err) {
        console.error('[IPC] Error exporting database:', err);
        throw err;
    }
});
// Get database info
electron_1.ipcMain.handle('db:info', async () => {
    try {
        const info = db_handler_1.default.getDatabaseInfo();
        return info;
    }
    catch (err) {
        console.error('[IPC] Error getting database info:', err);
        throw err;
    }
});
// Get file content (for viewing documents)
electron_1.ipcMain.handle('file:read', async (_event, filePath) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }
        const content = fs.readFileSync(filePath);
        // Convert Buffer to ArrayBuffer properly
        // content.buffer might be larger than the actual data, so we need to slice it
        const arrayBuffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
        return {
            success: true,
            data: arrayBuffer,
            mimeType: getMimeType(filePath)
        };
    }
    catch (err) {
        console.error('[IPC] Error reading file:', err);
        throw err;
    }
});
// Open file with default system application
electron_1.ipcMain.handle('file:open-external', async (_event, filePath) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }
        console.log('[IPC] Opening file with system app:', filePath);
        const result = await electron_1.shell.openPath(filePath);
        // shell.openPath returns empty string on success, or error message on failure
        if (result) {
            console.error('[IPC] Error opening file:', result);
            return { success: false, error: result };
        }
        return { success: true };
    }
    catch (err) {
        console.error('[IPC] Error opening file:', err);
        return { success: false, error: err.message };
    }
});
// Open file in a new Electron window
electron_1.ipcMain.handle('file:open-in-window', async (_event, filePath) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }
        console.log('[IPC] Opening file in new window:', filePath);
        const fileWindow = new electron_1.BrowserWindow({
            width: 1000,
            height: 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true
            },
            title: path.basename(filePath)
        });
        // Load the file using file:// protocol
        // For PDFs and other files that browsers can display
        fileWindow.loadFile(filePath);
        // Remove menu bar for cleaner look
        fileWindow.setMenuBarVisibility(false);
        return { success: true };
    }
    catch (err) {
        console.error('[IPC] Error opening file in window:', err);
        return { success: false, error: err.message };
    }
});
// Download file to user-selected location
electron_1.ipcMain.handle('file:download', async (_event, filePath) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }
        const fileName = path.basename(filePath);
        // Show save dialog
        const result = await electron_1.dialog.showSaveDialog({
            title: 'Save File',
            defaultPath: fileName,
            buttonLabel: 'Save'
        });
        if (result.canceled || !result.filePath) {
            return { success: false, canceled: true };
        }
        // Copy file to selected location
        fs.copyFileSync(filePath, result.filePath);
        console.log('[IPC] File downloaded to:', result.filePath);
        return { success: true, savedPath: result.filePath };
    }
    catch (err) {
        console.error('[IPC] Error downloading file:', err);
        return { success: false, error: err.message };
    }
});
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.pdf': 'application/pdf',
        '.xml': 'application/xml',
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}
// ============================================
// AI Semantic Search IPC Handlers (CORRETTO)
// ============================================
// Initialize AI model
electron_1.ipcMain.handle('ai:init', async (_event, payload) => {
    const requestId = payload?.requestId || 'init-req';
    try {
        console.log('[IPC] Initializing AI model...');
        const result = await aiSearch.initialize();
        return { requestId, status: 'ok', result };
    }
    catch (err) {
        console.error('[IPC] AI initialization CRITICAL error:', err);
        return { requestId, status: 'error', error: err.message };
    }
});
// Search similar documents
electron_1.ipcMain.handle('ai:search', async (_event, data) => {
    let query;
    let requestId = null;
    // LOGICA DI ESTRAZIONE ROBUSTA
    if (Array.isArray(data)) {
        // CASO 1: È un Array (Vettore embedding) -> Usalo direttamente
        query = new Float32Array(data);
        console.log('[IPC] Search input: Vector/Array');
    }
    else if (typeof data === 'object' && data !== null && 'query' in data) {
        // CASO 2: È un Oggetto { query: ..., requestId: ... }
        query = data.query;
        requestId = data.requestId;
        console.log('[IPC] Search input: Object with requestId');
    }
    else {
        // CASO 3: È una Stringa (o altro primitivo)
        query = data;
        console.log('[IPC] Search input: String/Raw');
    }
    if (!query || (Array.isArray(query) && query.length === 0)) {
        console.error('[IPC] AI Search: Query vuota o invalida ricevuta', data);
        return { requestId, status: 'error', error: 'Query vuota' };
    }
    try {
        // Pass database handler to search function (sqlite-vss based)
        const results = await aiSearch.search(db_handler_1.default, query);
        return { requestId, status: 'ok', results };
    }
    catch (err) {
        console.error('[IPC] AI search error:', err);
        return { requestId, status: 'error', error: err.message };
    }
});
// Generate embedding
electron_1.ipcMain.handle('ai:generate-embedding', async (_event, data) => {
    const text = (typeof data === 'object' && data !== null) ? data.text : data;
    const requestId = (typeof data === 'object' && data !== null) ? data.requestId : null;
    try {
        const embedding = await aiSearch.generateEmbedding(text);
        return { requestId, status: 'ok', embedding };
    }
    catch (err) {
        return { requestId, status: 'error', error: err.message };
    }
});
// Index a document
electron_1.ipcMain.handle('ai:index', async (_event, data) => {
    // Qui ci aspettiamo sempre un oggetto {id, text}
    try {
        const { id, text } = data;
        const result = await aiSearch.indexDocument(id, text);
        if (result.vector) {
            db_handler_1.default.saveVector(id, result.vector);
        }
        return { status: 'ok', id };
    }
    catch (err) {
        console.error('[IPC] AI indexing error:', err);
        throw err;
    }
});
electron_1.ipcMain.handle('ai:reindex-all', async (_event, data) => {
    const documents = Array.isArray(data) ? data : (data.documents || []);
    const requestId = (!Array.isArray(data) && data.requestId) ? data.requestId : null;
    try {
        let count = 0;
        for (const doc of documents) {
            const text = doc.text || `Document ${doc.id}`;
            const res = await aiSearch.indexDocument(doc.id, text);
            if (res.vector) {
                db_handler_1.default.saveVector(doc.id, res.vector);
            }
            count++;
        }
        return { requestId, status: 'ok', indexed: count };
    }
    catch (err) {
        console.error('[IPC] AI reindexing error:', err);
        return { requestId, status: 'error', error: err.message };
    }
});
electron_1.ipcMain.handle('dialog:show-message', async (event, options) => {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    // Mostra il dialog nativo
    await electron_1.dialog.showMessageBox(win, {
        type: options.type || 'info',
        title: 'DIP Reader',
        message: options.message,
        buttons: ['OK']
    });
    // Quando si chiude, Electron gestisce il focus automaticamente
    return true;
});
// ============================================
// End of IPC Handlers
// ============================================
electron_1.app.whenReady().then(createWindow);
// Cleanup on quit
electron_1.app.on('will-quit', () => {
    db_handler_1.default.close();
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
//# sourceMappingURL=main.js.map