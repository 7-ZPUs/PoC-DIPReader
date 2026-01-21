// src/logic/indexerLogic.ts

import { consumerPollProducersForChange } from "@angular/core/primitives/signals";
import type { OpfsDatabase } from "@sqlite.org/sqlite-wasm";
import { DOMParser } from '@xmldom/xmldom';

// This is a "pure" logic file, no Angular decorators
export class IndexerLogic {
  constructor(private db: OpfsDatabase | null, private fsHandle: FileSystemDirectoryHandle) { }

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
    const aipRoot = (aipElement.getElementsByTagName('AiPRoot')[0]?.textContent || '').trim();

    // Insert AiP
    const insertAipSql = `INSERT OR IGNORE INTO aip (uuid, document_class_id, archival_process_uuid) VALUES (?, ?, ?)`;
    this.db.exec({
      sql: insertAipSql,
      bind: [aipUUID, documentClassId, processUUID]
    });

    // Process Documents
    const documents = aipElement.getElementsByTagName('Document');
    for (let i = 0; i < documents.length; i++) {
      await this.processDocument(documents[i], aipUUID, aipRoot.replace(/\.\//, '')); // Ensure no leading ./
    }
  }

  private async processDocument(docElement: Element, aipUUID: string, currentPath: string): Promise<void> {
    if (!this.db) return;

    const docUUID = docElement.getAttribute('uuid') || '';
    const docPath = (docElement.getElementsByTagName('DocumentPath')[0]?.textContent || '').trim();

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
      await this.processFiles(filesElement, documentId, docUUID, `${currentPath}/${docPath.replace(/\.\//, '')}`); // Ensure no trailing slash
    }
  }

  private async processFiles(filesElement: Element, documentId: number, docUUID: string, currentPath: string): Promise<void> {
    if (!this.db) return;

    // Process Metadata file
    const metadata = filesElement.getElementsByTagName('Metadata')[0];
    if (metadata) {
      const metadataPath = (metadata.textContent || '').trim();
      await this.insertFile(metadataPath, false, documentId);
      await this.processMetadataFile(`${currentPath}/${metadataPath.replace(/\.\//, '')}`, documentId);
    }

    // Process Primary file
    const primary = filesElement.getElementsByTagName('Primary')[0];
    if (primary) {
      const primaryPath = (primary.textContent || '').trim();
      await this.insertFile(primaryPath, true, documentId);
    }

    // Process Attachments
    const attachments = filesElement.getElementsByTagName('Attachments');
    for (let i = 0; i < attachments.length; i++) {
      const attachmentPath = (attachments[i].textContent || '').trim();
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

  private async getFileHandle(path: string): Promise<FileSystemFileHandle | null> {
    // Normalize path and segments
    const cleaned = (path || '').normalize('NFC').replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
    if (!cleaned) {
      console.warn('getFileHandle called with empty/invalid path:', path);
      return null;
    }

    const parts = cleaned.split('/').map(p => p.trim()).filter(p => p !== '');
    let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = this.fsHandle;

    // Navigate directories with fallback when a direct getDirectoryHandle fails
    for (const part of parts.slice(0, -1)) {
      try {
        currentHandle = await (currentHandle as FileSystemDirectoryHandle).getDirectoryHandle(part);
        continue;
      } catch (err) {
        // Direct access failed, try case-insensitive fallback
      }

      // Fallback: try to find a directory with matching name (trimmed, case-insensitive)
      let found = false;
      for await (const entry of (currentHandle as FileSystemDirectoryHandle).entries()) {
        const [name, handle] = entry;
        if (handle.kind === 'directory' && name.trim().toLowerCase() === part.toLowerCase()) {
          currentHandle = handle as FileSystemDirectoryHandle;
          found = true;
          break;
        }
      }

      if (!found) {
        console.error('Could not resolve directory segment in path:', part, 'originalPath:', path);
        return null;
      }
    }

    // Now try to get the file handle, with similar fallback if direct call fails
    const fileName = parts[parts.length - 1];
    const targetNameClean = fileName.trim().toLowerCase();

    for await (const [name, handle] of (currentHandle as FileSystemDirectoryHandle).entries()) {
      const currentNameClean = name.trim().toLowerCase();

      if (handle.kind === 'file' && currentNameClean === targetNameClean) {
        try {
          // Verify we can actually touch the file before returning
          await (handle as FileSystemFileHandle).getFile();
          return handle as FileSystemFileHandle;
        } catch (e) {
          console.warn(`Found file ${name} but could not get file object:`, e);
          // Continue searching in case there's another match (unlikely but safe)
        }
      }
    }

    console.warn('File not found after exhaustive directory search:', fileName);
    return null;

    console.warn('File not found:', fileName);
    return null;
  }

  private async processMetadataFile(path: string, documentId: number): Promise<void> {
    console.log('Attempting to access metadata at:', path);
    const fileHandle = await this.getFileHandle(path);
    if (!fileHandle) {
      console.warn('Skipping inaccessible metadata:', path);
      return;
    }

    let file;
    try {
      file = await fileHandle.getFile();
    } catch (err: any) {
      console.warn('Cannot read metadata file:', fileHandle.name, '-', err.message);
      return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const content = new TextDecoder().decode(arrayBuffer);

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(content, "application/xml");

    // Check for parsing errors
    const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parserError) {
      console.error('XML parsing error in metadata file:', parserError.textContent);
      return;
    }

    // Example: Extract and log Title from Metadata
    const ChiaveDescrittiva = xmlDoc.getElementsByTagName('ChiaveDescrittiva')[0];
    const title = ChiaveDescrittiva?.textContent || '';
    const childs = ChiaveDescrittiva.childNodes;
    let value = '';
    Array.from(childs).forEach(child => {
      if (child.nodeType === 1) { // ELEMENT_NODE
        value += child.textContent || '';
      }
    });
    let query = 'INSERT OR IGNORE INTO metadata(meta_key, meta_value, document_id, meta_type) VALUES (?, ?, ?, ?)';
    this.db?.exec({
      sql: query,
      bind: ['ChiaveDescrittiva', value, documentId, 'string']
    });

    const IndiceDiClassificazione = xmlDoc.getElementsByTagName('IndiceDiClassificazione')[0];
    const Descrizione = xmlDoc.getElementsByTagName('Descrizione')[0];
    const PianoDiClassificazione = xmlDoc.getElementsByTagName('PianoDiClassificazione')[0];

    this.db?.exec({
      sql: query,
      bind: ['IndiceDiClassificazione', IndiceDiClassificazione?.textContent || '', documentId, 'string']
    });
    this.db?.exec({
      sql: query,
      bind: ['Descrizione', Descrizione?.textContent || '', documentId, 'string']
    });
    this.db?.exec({
      sql: query,
      bind: ['PianoDiClassificazione', PianoDiClassificazione?.textContent || '', documentId, 'string']
    });

    const TempoDiConservazione = xmlDoc.getElementsByTagName('TempoDiConservazione')[0];
    this.db?.exec({
      sql: query,
      bind: ['TempoDiConservazione', TempoDiConservazione?.textContent || '', documentId, 'number']
    });

    const Note = xmlDoc.getElementsByTagName('Note')[0];
    this.db?.exec({
      sql: query,
      bind: ['Note', Note?.textContent || '', documentId, 'string']
    });

  }
}