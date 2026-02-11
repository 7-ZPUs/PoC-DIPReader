// preload.js - Secure IPC bridge between renderer and main process
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Database operations
    db: {
        init: () => ipcRenderer.invoke('db:init'),
        open: (dipUUID) => ipcRenderer.invoke('db:open', dipUUID),
        index: (dipUUID, dipPath) => ipcRenderer.invoke('db:index', dipUUID, dipPath),
        query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
        list: () => ipcRenderer.invoke('db:list'),
        delete: (dipUUID) => ipcRenderer.invoke('db:delete', dipUUID),
        export: (exportPath) => ipcRenderer.invoke('db:export', exportPath),
        info: () => ipcRenderer.invoke('db:info')
    },
    
    // DIP operations
    dip: {
        selectDirectory: () => ipcRenderer.invoke('dip:select-directory')
    },
    
    // File operations
    file: {
        read: (filePath) => ipcRenderer.invoke('file:read', filePath),
        openExternal: (filePath) => ipcRenderer.invoke('file:open-external', filePath),
        download: (filePath) => ipcRenderer.invoke('file:download', filePath)
    },
    
    // AI Semantic Search operations
    ai: {
        init: () => ipcRenderer.invoke('ai:init'),
        index: (id, text) => ipcRenderer.invoke('ai:index', id, text),
        generateEmbedding: (text) => ipcRenderer.invoke('ai:generate-embedding', text),
        search: (query) => ipcRenderer.invoke('ai:search', query),
        reindexAll: (documents) => ipcRenderer.invoke('ai:reindex-all', documents),
        state: () => ipcRenderer.invoke('ai:state'),
        clear: () => ipcRenderer.invoke('ai:clear')
    }
});
