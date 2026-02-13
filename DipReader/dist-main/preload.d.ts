interface DbAPI {
    init: () => Promise<any>;
    open: (dipUUID: string) => Promise<any>;
    index: (dipUUID: string, dipPath: string) => Promise<any>;
    query: (sql: string, params?: any[]) => Promise<any>;
    list: () => Promise<any>;
    delete: (dipUUID: string) => Promise<any>;
    export: (exportPath?: string) => Promise<any>;
    info: () => Promise<any>;
}
interface DipAPI {
    selectDirectory: () => Promise<any>;
}
interface FileAPI {
    read: (filePath: string) => Promise<any>;
    openExternal: (filePath: string) => Promise<any>;
    openInWindow: (filePath: string) => Promise<any>;
    download: (filePath: string) => Promise<any>;
}
interface AiAPI {
    init: () => Promise<any>;
    index: (data: any) => Promise<any>;
    generateEmbedding: (data: any) => Promise<any>;
    search: (data: any) => Promise<any>;
    reindexAll: (data: any) => Promise<any>;
    state: () => Promise<any>;
    clear: () => Promise<any>;
}
interface UtilsAPI {
    showMessage: (message: string, type?: string) => Promise<any>;
}
interface ElectronAPI {
    db: DbAPI;
    dip: DipAPI;
    file: FileAPI;
    ai: AiAPI;
    utils: UtilsAPI;
}
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
export {};
//# sourceMappingURL=preload.d.ts.map