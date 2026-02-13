// preload.ts - Secure IPC bridge between renderer and main process
import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from './src/app/types/electron-api.types';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Database operations
    db: {
        init: () => ipcRenderer.invoke('db:init'),
        open: (dipUUID: string) => ipcRenderer.invoke('db:open', dipUUID),
        index: (dipUUID: string, dipPath: string) => ipcRenderer.invoke('db:index', dipUUID, dipPath),
        query: (sql: string, params?: any[]) => ipcRenderer.invoke('db:query', sql, params),
        list: () => ipcRenderer.invoke('db:list'),
        delete: (dipUUID: string) => ipcRenderer.invoke('db:delete', dipUUID),
        export: (exportPath?: string) => ipcRenderer.invoke('db:export', exportPath),
        info: () => ipcRenderer.invoke('db:info')
    },
    
    // DIP operations
    dip: {
        selectDirectory: () => ipcRenderer.invoke('dip:select-directory')
    },
    
    // File operations
    file: {
        read: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
        openExternal: (filePath: string) => ipcRenderer.invoke('file:open-external', filePath),
        openInWindow: (filePath: string) => ipcRenderer.invoke('file:open-in-window', filePath),
        download: (filePath: string) => ipcRenderer.invoke('file:download', filePath)
    },
    
    // AI Semantic Search operations
    ai: {
        init: () => ipcRenderer.invoke('ai:init'),
        index: (data: any) => ipcRenderer.invoke('ai:index', data),
        generateEmbedding: (data: any) => ipcRenderer.invoke('ai:generate-embedding', data),
        search: (data: any) => ipcRenderer.invoke('ai:search', data),
        reindexAll: (data: any) => ipcRenderer.invoke('ai:reindex-all', data),
        state: () => ipcRenderer.invoke('ai:state'),
        clear: () => ipcRenderer.invoke('ai:clear')
    },

    utils: {
        showMessage: (message: string, type: string = 'info') => ipcRenderer.invoke('dialog:show-message', { message, type })
    }
} as ElectronAPI);
