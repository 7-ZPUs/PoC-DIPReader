// src/logic/indexerLogic.ts

import type { OpfsDatabase } from "@sqlite.org/sqlite-wasm";
import { DOMParser } from '@xmldom/xmldom';

// This is a "pure" logic file, no Angular decorators
export class IndexerLogic {
  constructor(private db: OpfsDatabase | null, private fsHandle: FileSystemDirectoryHandle) {}

  async indexDip(): Promise<void> {
    await this.readDipIndex();
  }

  async readDipIndex(): Promise<void> {
    let entries = this.fsHandle.entries();
    let entry;
    while (entry = await entries.next(), !entry.done) {
      const [name, handle] = entry.value;
      if (handle.kind === 'file' && handle.name.includes('DiPIndex')) {
        const file = await (handle as FileSystemFileHandle).getFile();
        const arrayBuffer = await file.arrayBuffer();
        const content = new TextDecoder().decode(arrayBuffer);
        console.log("Trovato DiPIndex:", name);
        await this.parseDipIndexXml(content);
      }
    }
  }

  async parseDipIndexXml(xmlContent: string): Promise<void> {
    if (!this.db) {
      console.error('Database not initialized');
      return;
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
    
    // Check for parsing errors
    const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parserError) {
      console.error('XML parsing error:', parserError.textContent);
      return;
    }

    try {
      // Extract ProcessUUID from PackageInfo
      const packageInfo = xmlDoc.getElementsByTagName('PackageInfo')[0];
      const processUUIDElement = packageInfo?.getElementsByTagName('ProcessUUID')[0];
      const processUUID = processUUIDElement?.textContent;
      if (processUUID) {
        await this.insertArchivalProcess(processUUID);
      }

      // Extract and process DocumentClass elements
      const documentClasses = xmlDoc.getElementsByTagName('DocumentClass');
      for (let i = 0; i < documentClasses.length; i++) {
        await this.processDocumentClass(documentClasses[i], processUUID || '');
      }

      console.log('DiPIndex indexed successfully');
    } catch (error) {
      console.error('Error indexing DiPIndex:', error);
      throw error;
    }
  }

  private async insertArchivalProcess(uuid: string): Promise<void> {
    if (!this.db) return;

    const sql = `INSERT OR IGNORE INTO archival_process (uuid) VALUES (?)`;
    this.db.exec({
      sql,
      bind: [uuid]
    });
  }

  private async processDocumentClass(docClassElement: Element, processUUID: string): Promise<number> {
    if (!this.db) return 0;

    const className = docClassElement.getAttribute('name') || '';
    const classUUID = docClassElement.getAttribute('uuid') || '';

    // Insert document class
    const insertClassSql = `INSERT OR IGNORE INTO document_class (class_name) VALUES (?)`;
    this.db.exec({
      sql: insertClassSql,
      bind: [className]
    });

    // Get the document_class id
    const getIdSql = `SELECT id FROM document_class WHERE class_name = ?`;
    let documentClassId = 0;
    this.db.exec({
      sql: getIdSql,
      bind: [className],
      callback: (row) => {
        documentClassId = row[0] as number;
      }
    });

    // Process all AiP elements
    const aips = docClassElement.getElementsByTagName('AiP');
    for (let i = 0; i < aips.length; i++) {
      await this.processAiP(aips[i], documentClassId, processUUID);
    }

    return documentClassId;
  }

  private async processAiP(aipElement: Element, documentClassId: number, processUUID: string): Promise<void> {
    if (!this.db) return;

    const aipUUID = aipElement.getAttribute('uuid') || '';
    const aipRoot = aipElement.getElementsByTagName('AiPRoot')[0]?.textContent || '';

    // Insert AiP
    const insertAipSql = `INSERT OR IGNORE INTO aip (uuid, document_class_id, archival_process_uuid) VALUES (?, ?, ?)`;
    this.db.exec({
      sql: insertAipSql,
      bind: [aipUUID, documentClassId, processUUID]
    });

    // Process Documents
    const documents = aipElement.getElementsByTagName('Document');
    for (let i = 0; i < documents.length; i++) {
      await this.processDocument(documents[i], aipUUID);
    }
  }

  private async processDocument(docElement: Element, aipUUID: string): Promise<void> {
    if (!this.db) return;

    const docUUID = docElement.getAttribute('uuid') || '';
    const docPath = docElement.getElementsByTagName('DocumentPath')[0]?.textContent || '';

    // Insert Document
    const insertDocSql = `INSERT OR IGNORE INTO document (root_path, aip_uuid) VALUES (?, ?)`;
    this.db.exec({
      sql: insertDocSql,
      bind: [docPath, aipUUID]
    });

    // Get the document id
    let documentId = 0;
    const getDocIdSql = `SELECT id FROM document WHERE root_path = ? AND aip_uuid = ?`;
    this.db.exec({
      sql: getDocIdSql,
      bind: [docPath, aipUUID],
      callback: (row) => {
        documentId = row[0] as number;
      }
    });

    // Process Files
    const filesElement = docElement.getElementsByTagName('Files')[0];
    if (filesElement) {
      await this.processFiles(filesElement, documentId, docUUID);
    }
  }

  private async processFiles(filesElement: Element, documentId: number, docUUID: string): Promise<void> {
    if (!this.db) return;

    // Process Metadata file
    const metadata = filesElement.getElementsByTagName('Metadata')[0];
    if (metadata) {
      const metadataPath = metadata.textContent || '';
      await this.insertFile(metadataPath, false, documentId);
    }

    // Process Primary file
    const primary = filesElement.getElementsByTagName('Primary')[0];
    if (primary) {
      const primaryPath = primary.textContent || '';
      await this.insertFile(primaryPath, true, documentId);
    }

    // Process Attachments
    const attachments = filesElement.getElementsByTagName('Attachments');
    for (let i = 0; i < attachments.length; i++) {
      const attachmentPath = attachments[i].textContent || '';
      await this.insertFile(attachmentPath, false, documentId);
    }
  }

  private async insertFile(relativePath: string, isMain: boolean, documentId: number): Promise<void> {
    if (!this.db) return;

    const sql = `INSERT OR IGNORE INTO file (relative_path, is_main, document_id) VALUES (?, ?, ?)`;
    this.db.exec({
      sql,
      bind: [relativePath, isMain ? 1 : 0, documentId]
    });
  }
}