import { app, BrowserWindow, protocol, ipcMain, dialog, shell, IpcMainInvokeEvent } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import dbHandler from './db-handler';
import IndexerMain from './indexer-main';
import * as aiSearch from './ai-search';

// 1. Register the protocol as "Secure" BEFORE the app is ready. This avoids fetch issues when opening a file from fs (file preview)
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // 2. Handle file requests and inject COOP/COEP headers
    protocol.handle('app', async (request) => {
        const url = new URL(request.url);
        // Only take the path (e.g., /index.html) ignoring the hostname 'localhost'
        let relativePath = url.pathname;

        // If the path is empty or root, point to index.html
        if (relativePath === '/' || relativePath === '') {
            relativePath = 'index.html';
        }

        // Build the absolute path
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
            console.error(`[Protocol] Error loading ${filePath}:`, e);
            // Return a 404 instead of crashing the protocol
            return new Response('File not found', { status: 404 });
        }
    });

    mainWindow.loadURL('app://localhost');
}

// Helper function for MIME types
function getContentType(filePath: string): string {
    const ext = path.extname(filePath);
    if (ext === '.js') return 'text/javascript';
    if (ext === '.wasm') return 'application/wasm';
    if (ext === '.html') return 'text/html';
    if (ext === '.css') return 'text/css';
    return 'application/octet-stream';
}

async function generateSemanticEmbeddings(db: typeof dbHandler): Promise<{ success: boolean; indexed: number; total: number }> {
    console.log('[Semantic] Starting semantic indexing...');
    
    try {
        await aiSearch.initialize();
        
        // Query to get all documents with their metadata
        // Include all metadata for better semantic search (not just CategoriaProdotto)
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
            console.log(`[Semantic] First 3 docs to index:`, docs.slice(0, 3).map((d: any) => `ID=${d.id}, name=${d.name}, text="${d.combined_text}"`));
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
                } catch (error) {
                    console.error(`[Semantic] Error indexing document ${doc.id}:`, error);
                }
            }
        }
        
        console.log(`[Semantic] Semantic indexing completed: ${indexed}/${docs.length} documents indexed`);
        return { success: true, indexed, total: docs.length };
    } catch (error) {
        console.error('[Semantic] Error during semantic indexing:', error);
        throw error;
    }
}

// ============================================
// IPC Handlers for database operations
// ============================================

// Initialize database
ipcMain.handle('db:init', async () => {
    try {
        console.log('[IPC] Database initialization requested');
        return { status: 'success' };
    } catch (err) {
        console.error('[IPC] Database initialization error:', err);
        return { status: 'error', error: (err as Error).message };
    }
});

// Open or create a database for a DIP
ipcMain.handle('db:open', async (_event: IpcMainInvokeEvent, dipUUID: string) => {
    try {
        console.log('[IPC] Opening database for DIP:', dipUUID);
        const result = await dbHandler.openOrCreateDatabase(dipUUID);
        
        // Initialize AI model if vectors exist
        if (result.success) {
            const vectors = dbHandler.getAllVectors();
            if (vectors.length > 0) {
                console.log(`[IPC] Database has ${vectors.length} vectors indexed`);
                await aiSearch.initialize();
            }
        }
        
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
ipcMain.handle('db:index', async (_event: IpcMainInvokeEvent, dipUUID: string, dipPath: string) => {
    try {
        console.log('[IPC] Indexing DIP:', dipUUID, 'at path:', dipPath);
        
        // Open or create database
        await dbHandler.openOrCreateDatabase(dipUUID);
        
        // Check if database has data (for re-indexing)
        const info = dbHandler.getDatabaseInfo();
        if (info.fileCount && info.fileCount > 0) {
            console.log('[IPC] Database has existing data, clearing tables...');
            dbHandler.clearTables();
        }
        
        // Run structural indexer (XML → SQLite)
        const indexer = new IndexerMain(dbHandler, dipPath);
        await indexer.indexDip();
        
        console.log('[IPC] Structural indexing completed, starting semantic indexing...');
        
        // Run semantic indexing (SQLite → Vector embeddings)
        const semanticResult = await generateSemanticEmbeddings(dbHandler);
        
        console.log('[IPC] Indexing completed successfully');
        console.log(`[IPC] Total: ${semanticResult.indexed} documents indexed semantically`);
        
        return { 
            success: true, 
            dipUUID,
            semanticIndexed: semanticResult.indexed,
            semanticTotal: semanticResult.total
        };
    } catch (err) {
        console.error('[IPC] Indexing error:', err);
        throw err;
    }
});

// Execute a query
ipcMain.handle('db:query', async (_event: IpcMainInvokeEvent, sql: string, params: any[] = []) => {
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
ipcMain.handle('db:delete', async (_event: IpcMainInvokeEvent, dipUUID: string) => {
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
ipcMain.handle('db:export', async (_event: IpcMainInvokeEvent, exportPath?: string) => {
    try {
        let targetPath = exportPath;
        
        if (!targetPath) {
            const result = await dialog.showSaveDialog({
                title: 'Export Database',
                defaultPath: `${(dbHandler as any).currentDipUUID || 'dip'}.sqlite3`,
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
ipcMain.handle('file:read', async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }
        
        const content = fs.readFileSync(filePath);
        // Convert Buffer to ArrayBuffer properly
        // content.buffer might be larger than the actual data, so we need to slice it
        const arrayBuffer = content.buffer.slice(
            content.byteOffset, 
            content.byteOffset + content.byteLength
        );
        
        return { 
            success: true, 
            data: arrayBuffer,
            mimeType: getMimeType(filePath)
        };
    } catch (err) {
        console.error('[IPC] Error reading file:', err);
        throw err;
    }
});

// Open file with default system application
ipcMain.handle('file:open-external', async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }
        
        console.log('[IPC] Opening file with system app:', filePath);
        const result = await shell.openPath(filePath);
        
        // shell.openPath returns empty string on success, or error message on failure
        if (result) {
            console.error('[IPC] Error opening file:', result);
            return { success: false, error: result };
        }
        
        return { success: true };
    } catch (err) {
        console.error('[IPC] Error opening file:', err);
        return { success: false, error: (err as Error).message };
    }
});

// Open file in a new Electron window
ipcMain.handle('file:open-in-window', async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }
        
        console.log('[IPC] Opening file in new window:', filePath);
        
        const fileWindow = new BrowserWindow({
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
        
        fileWindow.setMenuBarVisibility(false);
        
        return { success: true };
    } catch (err) {
        console.error('[IPC] Error opening file in window:', err);
        return { success: false, error: (err as Error).message };
    }
});

// Download file to user-selected location
ipcMain.handle('file:download', async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found: ' + filePath);
        }
        
        const fileName = path.basename(filePath);
        
        // Show save dialog
        const result = await dialog.showSaveDialog({
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
    } catch (err) {
        console.error('[IPC] Error downloading file:', err);
        return { success: false, error: (err as Error).message };
    }
});

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
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
ipcMain.handle('ai:init', async (_event: IpcMainInvokeEvent, payload?: any) => {
    const requestId = payload?.requestId || 'init-req';
    try {
        console.log('[IPC] Initializing AI model...');
        const result = await aiSearch.initialize();
        return { requestId, status: 'ok', result };
    } catch (err) {
        console.error('[IPC] AI initialization CRITICAL error:', err);
        return { requestId, status: 'error', error: (err as Error).message };
    }
});

// Search similar documents
ipcMain.handle('ai:search', async (_event: IpcMainInvokeEvent, data: any) => {
    let query: string | Float32Array | any;
    let requestId: string | null = null;

    // Robust extraction logic
    if (Array.isArray(data)) {
        // CASE 1: It's an Array (Embedding vector) -> Use it directly
        query = new Float32Array(data);
        console.log('[IPC] Search input: Vector/Array');
    } else if (typeof data === 'object' && data !== null && 'query' in data) {
        // CASE 2: It's an Object { query: ..., requestId: ... }
        query = data.query;
        requestId = data.requestId;
        console.log('[IPC] Search input: Object with requestId');
    } else {
        // CASE 3: It's a String (or other primitive)
        query = data;
        console.log('[IPC] Search input: String/Raw');
    }

    if (!query || (Array.isArray(query) && query.length === 0)) {
        console.error('[IPC] AI Search: Empty or invalid query received', data);
        return { requestId, status: 'error', error: 'Empty query' };
    }

    try {
        // Pass database handler to search function (sqlite-vss based)
        const results = await aiSearch.search(dbHandler, query);
        return { requestId, status: 'ok', results };
    } catch (err) {
        console.error('[IPC] AI search error:', err);
        return { requestId, status: 'error', error: (err as Error).message };
    }
});

// Generate embedding
ipcMain.handle('ai:generate-embedding', async (_event: IpcMainInvokeEvent, data: any) => {
    const text = (typeof data === 'object' && data !== null) ? data.text : data;
    const requestId = (typeof data === 'object' && data !== null) ? data.requestId : null;

    try {
        const embedding = await aiSearch.generateEmbedding(text);
        return { requestId, status: 'ok', embedding };
    } catch (err) {
        return { requestId, status: 'error', error: (err as Error).message };
    }
});

// Index a document
ipcMain.handle('ai:index', async (_event: IpcMainInvokeEvent, data: any) => {
    try {
        const { id, text } = data;
        const result = await aiSearch.indexDocument(id, text);
        if (result.vector) {
            dbHandler.saveVector(id, result.vector);
        }
        
        return { status: 'ok', id };
    } catch (err) {
        console.error('[IPC] AI indexing error:', err);
        throw err;
    }
});

ipcMain.handle('ai:reindex-all', async (_event: IpcMainInvokeEvent, data: any) => {
    const documents = Array.isArray(data) ? data : (data.documents || []);
    const requestId = (!Array.isArray(data) && data.requestId) ? data.requestId : null;

    try {
       let count = 0;
        for (const doc of documents) {
             const text = doc.text || `Document ${doc.id}`;
             const res = await aiSearch.indexDocument(doc.id, text);
             if (res.vector) {
                 dbHandler.saveVector(doc.id, res.vector);
             }
             count++;
        }

        return { requestId, status: 'ok', indexed: count };
    } catch (err) {
        console.error('[IPC] AI reindexing error:', err);
        return { requestId, status: 'error', error: (err as Error).message };
    }
});

ipcMain.handle('dialog:show-message', async (event: IpcMainInvokeEvent, options: { message: string; type?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    await dialog.showMessageBox(win!, {
        type: (options.type as any) || 'info',
        title: 'DIP Reader',
        message: options.message,
        buttons: ['OK']
    });

    return true;
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
