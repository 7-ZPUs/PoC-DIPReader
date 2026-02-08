const { app, BrowserWindow, protocol, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dbHandler = require('./db-handler');
const IndexerMain = require('./indexer-main');
const aiSearch = require('./ai-search');

// 1. Registra il protocollo come "Secure" PRIMA che l'app sia ready
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // 2. Gestisci la richiesta dei file e inietta gli header COOP/COEP
    protocol.handle('app', async (request) => {
        const url = new URL(request.url);
        // Prende solo il percorso (es. /index.html) ignorando l'hostname 'localhost'
        let relativePath = url.pathname;

        // Se il path è vuoto o root, punta a index.html
        if (relativePath === '/' || relativePath === '') {
            relativePath = 'index.html';
        }

        // Costruisci il path assoluto (assicurati che il path alla dist sia corretto)
        const filePath = path.join(app.getAppPath(), 'dist/DipReader/browser', relativePath);

        try {
            const data = fs.readFileSync(filePath);
            return new Response(data, {
                headers: {
                    'Content-Type': getContentType(filePath),
                    'Cross-Origin-Opener-Policy': 'same-origin',
                    'Cross-Origin-Embedder-Policy': 'require-corp'
                }
            });
        } catch (e) {
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
    if (ext === '.js') return 'text/javascript';
    if (ext === '.wasm') return 'application/wasm';
    if (ext === '.html') return 'text/html';
    if (ext === '.css') return 'text/css';
    return 'application/octet-stream';
}

// ============================================
// IPC Handlers for Database Operations
// ============================================

// Initialize database
ipcMain.handle('db:init', async () => {
    try {
        console.log('[IPC] Database initialization requested');
        return { status: 'success' };
    } catch (err) {
        console.error('[IPC] Database initialization error:', err);
        return { status: 'error', error: err.message };
    }
});

// Open or create a database for a DIP
ipcMain.handle('db:open', async (event, dipUUID) => {
    try {
        console.log('[IPC] Opening database for DIP:', dipUUID);
        const result = dbHandler.openOrCreateDatabase(dipUUID);
        return result;
    } catch (err) {
        console.error('[IPC] Error opening database:', err);
        throw err;
    }
});

// Select DIP directory
ipcMain.handle('dip:select-directory', async () => {
    try {
        const result = await dialog.showOpenDialog({
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
    } catch (err) {
        console.error('[IPC] Error selecting directory:', err);
        throw err;
    }
});

// Index a DIP
ipcMain.handle('db:index', async (event, dipUUID, dipPath) => {
    try {
        console.log('[IPC] Indexing DIP:', dipUUID, 'at path:', dipPath);
        
        // Open or create database
        dbHandler.openOrCreateDatabase(dipUUID);
        
        // Check if database has data (for re-indexing)
        const info = dbHandler.getDatabaseInfo();
        if (info.fileCount > 0) {
            console.log('[IPC] Database has existing data, clearing tables...');
            dbHandler.clearTables();
        }
        
        // Run indexer
        const indexer = new IndexerMain(dbHandler, dipPath);
        await indexer.indexDip();
        
        console.log('[IPC] Indexing completed successfully');
        return { success: true, dipUUID };
    } catch (err) {
        console.error('[IPC] Indexing error:', err);
        throw err;
    }
});

// Execute a query
ipcMain.handle('db:query', async (event, sql, params = []) => {
    try {
        const result = dbHandler.executeQuery(sql, params);
        return result;
    } catch (err) {
        console.error('[IPC] Query error:', err);
        throw err;
    }
});

// List all databases
ipcMain.handle('db:list', async () => {
    try {
        const databases = dbHandler.listDatabases();
        return databases;
    } catch (err) {
        console.error('[IPC] Error listing databases:', err);
        throw err;
    }
});

// Delete a database
ipcMain.handle('db:delete', async (event, dipUUID) => {
    try {
        console.log('[IPC] Deleting database:', dipUUID);
        const result = dbHandler.deleteDatabase(dipUUID);
        return result;
    } catch (err) {
        console.error('[IPC] Error deleting database:', err);
        throw err;
    }
});

// Export database
ipcMain.handle('db:export', async (event, exportPath) => {
    try {
        let targetPath = exportPath;
        
        if (!targetPath) {
            const result = await dialog.showSaveDialog({
                title: 'Export Database',
                defaultPath: `${dbHandler.currentDipUUID || 'dip'}.sqlite3`,
                filters: [
                    { name: 'SQLite Database', extensions: ['sqlite3', 'db'] }
                ]
            });
            
            if (result.canceled) {
                return { canceled: true };
            }
            
            targetPath = result.filePath;
        }
        
        const exportResult = dbHandler.exportDatabase(targetPath);
        return exportResult;
    } catch (err) {
        console.error('[IPC] Error exporting database:', err);
        throw err;
    }
});

// Get database info
ipcMain.handle('db:info', async () => {
    try {
        const info = dbHandler.getDatabaseInfo();
        return info;
    } catch (err) {
        console.error('[IPC] Error getting database info:', err);
        throw err;
    }
});

// Get file content (for viewing documents)
ipcMain.handle('file:read', async (event, filePath) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }
        
        const content = fs.readFileSync(filePath);
        return { 
            success: true, 
            data: content.buffer,
            mimeType: getMimeType(filePath)
        };
    } catch (err) {
        console.error('[IPC] Error reading file:', err);
        throw err;
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
// AI Semantic Search IPC Handlers
// ============================================

// Initialize AI model
ipcMain.handle('ai:init', async () => {
    try {
        console.log('[IPC] Initializing AI model...');
        const result = await aiSearch.initialize();
        console.log('[IPC] AI model initialized:', result);
        return result;
    } catch (err) {
        console.error('[IPC] AI initialization error:', err);
        throw err;
    }
});

// Index a document for semantic search
ipcMain.handle('ai:index', async (event, id, text) => {
    try {
        const result = await aiSearch.indexDocument(id, text);
        return result;
    } catch (err) {
        console.error('[IPC] AI indexing error:', err);
        throw err;
    }
});

// Generate embedding for text
ipcMain.handle('ai:generate-embedding', async (event, text) => {
    try {
        const embedding = await aiSearch.generateEmbedding(text);
        return embedding;
    } catch (err) {
        console.error('[IPC] AI embedding generation error:', err);
        throw err;
    }
});

// Search similar documents
ipcMain.handle('ai:search', async (event, query) => {
    try {
        const results = await aiSearch.search(query);
        return results;
    } catch (err) {
        console.error('[IPC] AI search error:', err);
        throw err;
    }
});

// Reindex all documents
ipcMain.handle('ai:reindex-all', async (event, documents) => {
    try {
        console.log('[IPC] Reindexing all documents:', documents.length);
        const result = await aiSearch.reindexAll(documents);
        return result;
    } catch (err) {
        console.error('[IPC] AI reindexing error:', err);
        throw err;
    }
});

// Get AI state
ipcMain.handle('ai:state', async () => {
    try {
        const state = aiSearch.getState();
        return state;
    } catch (err) {
        console.error('[IPC] AI state error:', err);
        throw err;
    }
});

// Clear AI index
ipcMain.handle('ai:clear', async () => {
    try {
        const result = aiSearch.clearIndex();
        return result;
    } catch (err) {
        console.error('[IPC] AI clear error:', err);
        throw err;
    }
});

// ============================================
// End of IPC Handlers
// ============================================

app.whenReady().then(createWindow);

// Cleanup on quit
app.on('will-quit', () => {
    dbHandler.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});