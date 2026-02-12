import type { OpfsDatabase } from '@sqlite.org/sqlite-wasm';
import { DOMParser } from '@xmldom/xmldom';

// Logica di indicizzazione DIP (worker-safe, senza Angular)
export class IndexerLogic {
  constructor(private db: OpfsDatabase | null, private input: FileSystemDirectoryHandle | File[]) {}

  async indexDip(): Promise<void> {
    if (this.input instanceof FileSystemDirectoryHandle) {
      await this.readDipIndexFromHandle();
    }
  }

  async indexDipFromFiles(): Promise<void> {
    if (Array.isArray(this.input)) {
      await this.readDipIndexFromFiles();
    }
  }

  private async readDipIndexFromHandle(): Promise<void> {
    if (!(this.input instanceof FileSystemDirectoryHandle)) return;
    for await (const entry of this.input.entries() as AsyncIterable<[string, FileSystemHandle]>) {
      const [name, handle] = entry;
      if (handle.kind === 'file' && handle.name.includes('DiPIndex')) {
        const file = await (handle as FileSystemFileHandle).getFile();
        const arrayBuffer = await file.arrayBuffer();
        const content = new TextDecoder().decode(arrayBuffer);
        console.log('Trovato DiPIndex:', name);
        await this.parseDipIndexXml(content);
      }
    }
  }

  private async readDipIndexFromFiles(): Promise<void> {
    if (!Array.isArray(this.input)) return;
    for (const file of this.input) {
      if (file.name.includes('DiPIndex')) {
        const arrayBuffer = await file.arrayBuffer();
        const content = new TextDecoder().decode(arrayBuffer);
        console.log('Trovato DiPIndex:', file.name);
        await this.parseDipIndexXml(content);
      }
    }
  }

  private async parseDipIndexXml(xmlContent: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized in IndexerLogic');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');

    const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parserError) {
      console.error('XML parsing error:', parserError.textContent);
      return;
    }

    try {
      const packageInfo = xmlDoc.getElementsByTagName('PackageInfo')[0];
      const processUUIDElement = packageInfo?.getElementsByTagName('ProcessUUID')[0];
      const processUUID = processUUIDElement?.textContent || '';
      if (processUUID) {
        await this.insertArchivalProcess(processUUID);
      }

      const documentClasses = xmlDoc.getElementsByTagName('DocumentClass');
      for (let i = 0; i < documentClasses.length; i++) {
        await this.processDocumentClass(documentClasses[i], processUUID);
      }

      console.log('DiPIndex indexed successfully');
    } catch (error) {
      console.error('Error indexing DiPIndex:', error);
      throw error;
    }
  }

  private async insertArchivalProcess(uuid: string): Promise<void> {
    if (!this.db) return;

    this.db.exec({
      sql: 'INSERT OR IGNORE INTO archival_process (uuid) VALUES (?)',
      bind: [uuid]
    });
  }

  private async processDocumentClass(docClassElement: Element, processUUID: string): Promise<number> {
    if (!this.db) return 0;

    const className = docClassElement.getAttribute('name') || '';
    const classUUID = docClassElement.getAttribute('uuid') || '';

    this.db.exec({
      sql: 'INSERT OR IGNORE INTO document_class (class_name) VALUES (?)',
      bind: [className]
    });

    let documentClassId = 0;
    this.db.exec({
      sql: 'SELECT id FROM document_class WHERE class_name = ?',
      bind: [className],
      callback: (row) => {
        documentClassId = row[0] as number;
      }
    });

    const aips = docClassElement.getElementsByTagName('AiP');
    for (let i = 0; i < aips.length; i++) {
      await this.processAiP(aips[i], documentClassId, processUUID, classUUID);
    }

    return documentClassId;
  }

  private async processAiP(
    aipElement: Element,
    documentClassId: number,
    processUUID: string,
    classUUID: string
  ): Promise<void> {
    if (!this.db) return;

    const aipUUID = aipElement.getAttribute('uuid') || '';
    const aipRoot = aipElement.getElementsByTagName('AiPRoot')[0]?.textContent || '';

    this.db.exec({
      sql: 'INSERT OR IGNORE INTO aip (uuid, document_class_id, archival_process_uuid) VALUES (?, ?, ?)',
      bind: [aipUUID, documentClassId, processUUID]
    });

    const documents = aipElement.getElementsByTagName('Document');
    for (let i = 0; i < documents.length; i++) {
      await this.processDocument(documents[i], aipUUID, processUUID, classUUID);
    }
  }

  private async processDocument(docElement: Element, aipUUID: string, processUUID: string, classUUID: string): Promise<void> {
    if (!this.db) return;

    const docUUID = docElement.getAttribute('uuid') || '';
    const docPath = docElement.getElementsByTagName('DocumentPath')[0]?.textContent || docUUID || `doc-${Math.random().toString(16).slice(2)}`;

    this.db.exec({
      sql: 'INSERT OR IGNORE INTO document (root_path, aip_uuid) VALUES (?, ?)',
      bind: [docPath, aipUUID]
    });

    let documentId = 0;
    this.db.exec({
      sql: 'SELECT id FROM document WHERE root_path = ? AND aip_uuid = ?',
      bind: [docPath, aipUUID],
      callback: (row) => {
        documentId = row[0] as number;
      }
    });

    const filesElement = docElement.getElementsByTagName('Files')[0];
    if (filesElement) {
      await this.processFiles(filesElement, documentId, docUUID, aipUUID, processUUID, classUUID, docPath);
    }

    // Layer tecnico: inseriamo nodo documento e path fisico
    this.insertNodeWithPath(docPath, 'file');
    this.insertPhysicalPath(docPath, docPath);

    // Metadati tecnici minimali
    const rawMeta = {
      docUUID,
      aipUUID,
      processUUID,
      classUUID,
      documentPath: docPath
    };
    this.insertRawMetadata(docPath, rawMeta);
    this.insertFlattenedAttributes(docPath, rawMeta);
  }

  private async processFiles(
    filesElement: Element,
    documentId: number,
    docUUID: string,
    aipUUID: string,
    processUUID: string,
    classUUID: string,
    docPath: string
  ): Promise<void> {
    if (!this.db) return;

    const metadata = filesElement.getElementsByTagName('Metadata')[0];
    if (metadata) {
      const metadataPath = metadata.textContent || '';
      if (metadataPath) {
        await this.insertFile(metadataPath, false, documentId);
        this.insertNodeWithPath(metadataPath, 'file');
        this.insertPhysicalPath(metadataPath, metadataPath);
        const metaRaw = { docUUID, aipUUID, processUUID, classUUID, metadataPath, documentPath: docPath };
        this.insertRawMetadata(metadataPath, metaRaw);
        this.insertFlattenedAttributes(metadataPath, metaRaw);
      }
    }

    const primary = filesElement.getElementsByTagName('Primary')[0];
    if (primary) {
      const primaryPath = primary.textContent || '';
      if (primaryPath) {
        await this.insertFile(primaryPath, true, documentId);
        this.insertNodeWithPath(primaryPath, 'file');
        this.insertPhysicalPath(primaryPath, primaryPath);
        const primaryRaw = { docUUID, aipUUID, processUUID, classUUID, primaryPath, documentPath: docPath, isPrimary: true };
        this.insertRawMetadata(primaryPath, primaryRaw);
        this.insertFlattenedAttributes(primaryPath, primaryRaw);
      }
    }

    const attachments = filesElement.getElementsByTagName('Attachments');
    for (let i = 0; i < attachments.length; i++) {
      const attachmentPath = attachments[i].textContent || '';
      if (attachmentPath) {
        await this.insertFile(attachmentPath, false, documentId);
        this.insertNodeWithPath(attachmentPath, 'file');
        this.insertPhysicalPath(attachmentPath, attachmentPath);
        const attRaw = { docUUID, aipUUID, processUUID, classUUID, attachmentPath, documentPath: docPath };
        this.insertRawMetadata(attachmentPath, attRaw);
        this.insertFlattenedAttributes(attachmentPath, attRaw);
      }
    }
  }

  private async insertFile(relativePath: string, isMain: boolean, documentId: number): Promise<void> {
    if (!this.db) return;

    this.db.exec({
      sql: 'INSERT OR IGNORE INTO file (relative_path, is_main, document_id) VALUES (?, ?, ?)',
      bind: [relativePath, isMain ? 1 : 0, documentId]
    });
  }

  private insertNodeWithPath(logicalPath: string, type: 'file' | 'folder'): void {
    if (!this.db || !logicalPath) return;
    const parts = logicalPath.split('/');
    const parent = parts.slice(0, -1).join('/');
    const name = parts[parts.length - 1];
    this.db.exec({
      sql: 'INSERT OR IGNORE INTO nodes (logical_path, parent_path, name, type) VALUES (?, ?, ?, ?)',
      bind: [logicalPath, parent, name, type]
    });
  }

  private insertPhysicalPath(logicalPath: string, physicalPath: string): void {
    if (!this.db || !logicalPath) return;
    this.db.exec({
      sql: 'INSERT OR REPLACE INTO physical_paths (logical_path, physical_path) VALUES (?, ?)',
      bind: [logicalPath, physicalPath]
    });
  }

  private insertRawMetadata(logicalPath: string, payload: any): void {
    if (!this.db || !logicalPath) return;
    try {
      const data = JSON.stringify(payload);
      this.db.exec({
        sql: 'INSERT OR REPLACE INTO raw_metadata (logical_path, data) VALUES (?, ?)',
        bind: [logicalPath, data]
      });
    } catch (err) {
      console.error('Errore serializzazione metadati raw', err);
    }
  }

  private insertFlattenedAttributes(logicalPath: string, payload: Record<string, any>): void {
    if (!this.db || !logicalPath || !payload) return;
    const flat = this.flattenObject(payload);
    flat.forEach(({ key, value }) => {
      if (value && String(value).length < 2000) {
        if (this.db) {
          this.db.exec({
            sql: 'INSERT OR IGNORE INTO metadata_attributes (logical_path, key, value) VALUES (?, ?, ?)',
            bind: [logicalPath, key, String(value)]
          });
        }
      }
    });
  }

  private flattenObject(obj: any, prefix = ''): Array<{ key: string; value: string }> {
    const out: Array<{ key: string; value: string }> = [];
    if (!obj || typeof obj !== 'object') return out;

    Object.keys(obj).forEach((k) => {
      const val = obj[k];
      const newKey = prefix ? `${prefix}.${k}` : k;
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        out.push(...this.flattenObject(val, newKey));
      } else {
        out.push({ key: newKey, value: String(val) });
      }
    });
    return out;
  }
}
