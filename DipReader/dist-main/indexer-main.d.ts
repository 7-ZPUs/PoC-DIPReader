import type DatabaseHandler from './db-handler';
declare class IndexerMain {
    private db;
    private dipRootPath;
    constructor(db: typeof DatabaseHandler, dipRootPath: string);
    indexDip(): Promise<void>;
    readDipIndex(): Promise<void>;
    parseDipIndexXml(xmlContent: string): Promise<void>;
    insertArchivalProcess(uuid: string): void;
    processDocumentClass(docClassElement: Element): number;
    processAiP(aipElement: Element, documentClassId: number): void;
    processDocument(docElement: Element, aipUUID: string, currentPath: string): void;
    processFiles(filesElement: Element, documentId: number, currentPath: string): void;
    insertFile(root_path: string, relativePath: string, isMain: boolean, documentId: number): void;
    getFilePath(relativePath: string): string | null;
    processMetadataFile(relativePath: string, documentId: number): void;
    insertMetadata(key: string, value: string, documentId: number, metaType?: string, fileId?: number | null): void;
    extractOptionalMetadata(xmlDoc: any, documentId: number, tagName: string, metaType?: string): void;
    /**
     * Extract Impronta (hash) for ALL files: main document + each attachment.
     * Maps UUID → Impronta from DocumentoInformatico/Allegati, then UUID → file path
     * from ArchimemoData, and finally looks up file_id in the database.
     */
    processImpronte(xmlDoc: any, documentId: number): void;
    processFasi(xmlDoc: any, documentId: number): void;
    insertFase(faseElement: Element, procedureId: number): void;
    processSoggetti(xmlDoc: any, documentId: number): void;
    insertSubject(soggettoElement: Element): number | null;
    insertSubjectPF(element: Element, subjectId: number): void;
    insertSubjectPG(element: Element, subjectId: number): void;
    insertSubjectPAI(element: Element, subjectId: number): void;
    insertSubjectPAE(element: Element, subjectId: number): void;
    insertSubjectAS(element: Element, subjectId: number): void;
    insertSubjectSQ(element: Element, subjectId: number): void;
    extractDigitalAddresses(element: Element): string;
}
export default IndexerMain;
//# sourceMappingURL=indexer-main.d.ts.map