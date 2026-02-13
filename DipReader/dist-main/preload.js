"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// preload.ts - Secure IPC bridge between renderer and main process
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // Database operations
    db: {
        init: () => electron_1.ipcRenderer.invoke('db:init'),
        open: (dipUUID) => electron_1.ipcRenderer.invoke('db:open', dipUUID),
        index: (dipUUID, dipPath) => electron_1.ipcRenderer.invoke('db:index', dipUUID, dipPath),
        query: (sql, params) => electron_1.ipcRenderer.invoke('db:query', sql, params),
        list: () => electron_1.ipcRenderer.invoke('db:list'),
        delete: (dipUUID) => electron_1.ipcRenderer.invoke('db:delete', dipUUID),
        export: (exportPath) => electron_1.ipcRenderer.invoke('db:export', exportPath),
        info: () => electron_1.ipcRenderer.invoke('db:info')
    },
    // DIP operations
    dip: {
        selectDirectory: () => electron_1.ipcRenderer.invoke('dip:select-directory')
    },
    // File operations
    file: {
        read: (filePath) => electron_1.ipcRenderer.invoke('file:read', filePath),
        openExternal: (filePath) => electron_1.ipcRenderer.invoke('file:open-external', filePath),
        openInWindow: (filePath) => electron_1.ipcRenderer.invoke('file:open-in-window', filePath),
        download: (filePath) => electron_1.ipcRenderer.invoke('file:download', filePath)
    },
    // AI Semantic Search operations
    ai: {
        init: () => electron_1.ipcRenderer.invoke('ai:init'),
        index: (data) => electron_1.ipcRenderer.invoke('ai:index', data),
        generateEmbedding: (data) => electron_1.ipcRenderer.invoke('ai:generate-embedding', data),
        search: (data) => electron_1.ipcRenderer.invoke('ai:search', data),
        reindexAll: (data) => electron_1.ipcRenderer.invoke('ai:reindex-all', data),
        state: () => electron_1.ipcRenderer.invoke('ai:state'),
        clear: () => electron_1.ipcRenderer.invoke('ai:clear')
    },
    utils: {
        showMessage: (message, type = 'info') => electron_1.ipcRenderer.invoke('dialog:show-message', { message, type })
    }
});
//# sourceMappingURL=preload.js.map