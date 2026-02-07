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
    //const classUUID = docClassElement.getAttribute('uuid') || '';

    // Insert document class
    console.log("Processing DocumentClass:", className);
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
    const insertAipSql = `INSERT OR IGNORE INTO aip (uuid, document_class_id, archival_process_uuid, root_path) VALUES (?, ?, ?, ?)`;
    this.db.exec({
      sql: insertAipSql,
      bind: [aipUUID, documentClassId, processUUID, aipRoot]
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
    const metadataPath = (metadata.textContent || '').trim();
    if (metadata) {
      await this.insertFile(currentPath, metadataPath, false, documentId);
    }

    // Process Primary file
    const primary = filesElement.getElementsByTagName('Primary')[0];
    if (primary) {
      const primaryPath = (primary.textContent || '').trim();
      await this.insertFile(currentPath, primaryPath, true, documentId);
    }

    // Process Attachments
    const attachments = filesElement.getElementsByTagName('Attachments');
    for (let i = 0; i < attachments.length; i++) {
      const attachmentPath = (attachments[i].textContent || '').trim();
      await this.insertFile(currentPath, attachmentPath, false, documentId);
    }

    await this.processMetadataFile(`${currentPath}/${metadataPath.replace(/\.\//, '')}`, documentId);
  }

  private async insertFile(root_path: string, relativePath: string, isMain: boolean, documentId: number): Promise<void> {
    if (!this.db) return;

    const sql = `INSERT OR IGNORE INTO file (relative_path, is_main, document_id, root_path) VALUES (?, ?, ?, ?)`;
    this.db.exec({
      sql,
      bind: [relativePath, isMain ? 1 : 0, documentId, root_path + '/' + relativePath.replace(/\.\//, '')]
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
    const Classificazione = xmlDoc.getElementsByTagName('Classificazione')[0];
    const Descrizione = Classificazione?.getElementsByTagName('Descrizione')[0];
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

    let Impronta = null;
    const documentoInformatico = xmlDoc.getElementsByTagName('DocumentoInformatico')[0];
    if (documentoInformatico) {
      const idDoc = documentoInformatico.getElementsByTagName('IdDoc')[0];
      if (idDoc) {
        Impronta = idDoc.getElementsByTagName('Impronta')[0];
      }
    }
    this.db?.exec({
      sql: query,
      bind: ['Impronta', Impronta?.textContent || '', documentId, 'string']
    });

    // Metadati generici aggiuntivi
    const DataFattura = xmlDoc.getElementsByTagName('DataFattura')[0];
    if (DataFattura) {
      this.db?.exec({
        sql: query,
        bind: ['DataFattura', DataFattura.textContent || '', documentId, 'date']
      });
    }

    const NumeroFattura = xmlDoc.getElementsByTagName('NumeroFattura')[0];
    if (NumeroFattura) {
      this.db?.exec({
        sql: query,
        bind: ['NumeroFattura', NumeroFattura.textContent || '', documentId, 'string']
      });
    }

    const CodiceFiscale = xmlDoc.getElementsByTagName('CodiceFiscale')[0];
    if (CodiceFiscale) {
      this.db?.exec({
        sql: query,
        bind: ['CodiceFiscale', CodiceFiscale.textContent || '', documentId, 'string']
      });
    }

    const Nome = xmlDoc.getElementsByTagName('Nome')[0];
    if (Nome) {
      this.db?.exec({
        sql: query,
        bind: ['Nome', Nome.textContent || '', documentId, 'string']
      });
    }

    const Version = xmlDoc.getElementsByTagName('Version')[0] || 
                    xmlDoc.getElementsByTagName('VersioneDelDocumento')[0];
    if (Version) {
      this.db?.exec({
        sql: query,
        bind: ['Version', Version.textContent || '', documentId, 'string']
      });
    }

    const TipoRuolo = xmlDoc.getElementsByTagName('TipoRuolo')[0];
    if (TipoRuolo) {
      this.db?.exec({
        sql: query,
        bind: ['TipoRuolo', TipoRuolo.textContent || '', documentId, 'string']
      });
    }

    const CategoriaProdotto = xmlDoc.getElementsByTagName('CategoriaProdotto')[0];
    if (CategoriaProdotto) {
      this.db?.exec({
        sql: query,
        bind: ['CategoriaProdotto', CategoriaProdotto.textContent || '', documentId, 'string']
      });
    }

    const IdAggregazione = xmlDoc.getElementsByTagName('IdAggregazione')[0] ||
                          xmlDoc.getElementsByTagName('IdAgg')[0];
    if (IdAggregazione) {
      this.db?.exec({
        sql: query,
        bind: ['IdAggregazione', IdAggregazione.textContent || '', documentId, 'string']
      });
    }

    const ProdottoSoftware = xmlDoc.getElementsByTagName('ProdottoSoftware')[0];
    if (ProdottoSoftware) {
      const prodottoValue = ProdottoSoftware.getElementsByTagName('NomeProdotto')[0]?.textContent || 
                           ProdottoSoftware.textContent || '';
      this.db?.exec({
        sql: query,
        bind: ['ProdottoSoftware', prodottoValue, documentId, 'string']
      });
    }

    const Produttore = xmlDoc.getElementsByTagName('Produttore')[0];
    if (Produttore) {
      const produttoreValue = Produttore.getElementsByTagName('Denominazione')[0]?.textContent || 
                             Produttore.textContent || '';
      this.db?.exec({
        sql: query,
        bind: ['Produttore', produttoreValue, documentId, 'string']
      });
    }

    query = 'INSERT OR IGNORE INTO metadata(meta_key, meta_value, file_id, meta_type) VALUES (?, ?, ?, ?)';

    const attachments = xmlDoc.getElementsByTagName('IndiceAllegati');
    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const IdDoc = attachment.getElementsByTagName('IdDoc')[0];
      let attachmentId = IdDoc?.getElementsByTagName('Identificativo')[0]?.textContent || '';
      if (attachmentId) {
        let description = attachment.getElementsByTagName('Descrizione')[0]?.textContent || '';
        let Impronta = attachment.getElementsByTagName('Impronta')[0]?.textContent || '';
        let id_query = 'SELECT id FROM file WHERE relative_path LIKE ?'; // Only relative path is not a problem here since the attachment paths include unique IDs
        this.db?.exec({
          sql: id_query,
          bind: [`%${attachmentId}%`],
          callback: (row) => {
            attachmentId = row[0] as string;
          }
        });
        console.log('Processing attachment metadata for file ID:', attachmentId);
        this.db?.exec({
          sql: query,
          bind: [`Descrizione`, description, attachmentId, 'string']
        });
        this.db?.exec({
          sql: query,
          bind: [`Impronta`, Impronta || '', attachmentId, 'string']
        });
      }
    }

    // Process Soggetti (Subjects) - strutturati nelle tabelle apposite
    await this.processSoggetti(xmlDoc, documentId);

    // Process Fasi (Phases) - strutturati nelle tabelle apposite
    await this.processFasi(xmlDoc, documentId);

    console.log('Metadata processed for document ID:', documentId);
  }

  private async processFasi(xmlDoc: Document, documentId: number): Promise<void> {
    if (!this.db) return;

    // Le fasi sono associate a procedure amministrative
    // Cerca prima se esiste una procedura amministrativa nel documento
    const proceduraElement = xmlDoc.getElementsByTagName('ProceduraAmministrativa')[0] ||
                            xmlDoc.getElementsByTagName('ProcedimentoAmministrativo')[0];
    
    if (!proceduraElement) return;

    // Estrai dati della procedura
    const catalogUri = proceduraElement.getElementsByTagName('CatalogoURI')[0]?.textContent || '';
    const titolo = proceduraElement.getElementsByTagName('Titolo')[0]?.textContent || '';
    const oggettoInteresse = proceduraElement.getElementsByTagName('OggettoDiInteresse')[0]?.textContent || '';

    // Inserisci la procedura amministrativa
    this.db.exec({
      sql: 'INSERT INTO administrative_procedure (catalog_uri, title, subject_of_interest) VALUES (?, ?, ?)',
      bind: [catalogUri, titolo, oggettoInteresse || null]
    });

    let procedureId = 0;
    this.db.exec({
      sql: 'SELECT last_insert_rowid() as id',
      callback: (row) => {
        procedureId = row[0] as number;
      }
    });

    if (procedureId === 0) return;

    // Aggiorna il documento con l'aggregazione se necessario
    const aggElement = xmlDoc.getElementsByTagName('Agg')[0];
    if (aggElement) {
      const tipoAgg = aggElement.getElementsByTagName('TipoAggregazione')[0]?.textContent || '';
      
      this.db.exec({
        sql: 'INSERT INTO document_aggregation (procedure_id, type) VALUES (?, ?)',
        bind: [procedureId, tipoAgg]
      });

      let aggregationId = 0;
      this.db.exec({
        sql: 'SELECT last_insert_rowid() as id',
        callback: (row) => {
          aggregationId = row[0] as number;
        }
      });

      if (aggregationId > 0) {
        this.db.exec({
          sql: 'UPDATE document SET aggregation_id = ? WHERE id = ?',
          bind: [aggregationId, documentId]
        });
      }
    }

    // Estrai e inserisci le fasi
    const fasiElements = proceduraElement.getElementsByTagName('Fase') ||
                        proceduraElement.getElementsByTagName('Fasi');
    
    for (let i = 0; i < fasiElements.length; i++) {
      const fase = fasiElements[i];
      
      // Se Fasi è un contenitore, cerca le singole Fase al suo interno
      if (fase.tagName === 'Fasi') {
        const faseSingole = fase.getElementsByTagName('Fase');
        for (let j = 0; j < faseSingole.length; j++) {
          await this.insertFase(faseSingole[j], procedureId);
        }
      } else {
        await this.insertFase(fase, procedureId);
      }
    }
  }

  private async insertFase(faseElement: Element, procedureId: number): Promise<void> {
    if (!this.db) return;

    const tipo = faseElement.getElementsByTagName('TipoFase')[0]?.textContent || 
                faseElement.getElementsByTagName('Tipo')[0]?.textContent || '';
    const dataInizio = faseElement.getElementsByTagName('DataInizio')[0]?.textContent || 
                      faseElement.getElementsByTagName('DataApertura')[0]?.textContent || '';
    const dataFine = faseElement.getElementsByTagName('DataFine')[0]?.textContent || 
                    faseElement.getElementsByTagName('DataChiusura')[0]?.textContent || null;

    if (tipo && dataInizio) {
      this.db.exec({
        sql: 'INSERT INTO phase (type, start_date, end_date, administrative_procedure_id) VALUES (?, ?, ?, ?)',
        bind: [tipo, dataInizio, dataFine, procedureId]
      });
    }
  }

  private async processSoggetti(xmlDoc: Document, documentId: number): Promise<void> {
    if (!this.db) return;

    const soggettiElement = xmlDoc.getElementsByTagName('Soggetti')[0];
    if (!soggettiElement) return;

    const ruoli = soggettiElement.getElementsByTagName('Ruolo');
    for (let i = 0; i < ruoli.length; i++) {
      const ruolo = ruoli[i];
      
      // Struttura: <Ruolo><TipoRuolo/><Destinatario><PF>...</PF></Destinatario></Ruolo>
      // Oppure: <Ruolo><Destinatario><TipoRuolo/><PF>...</PF></Destinatario></Ruolo>
      
      // Cerca elementi figli che rappresentano il tipo di ruolo (Destinatario, Mittente, ecc.)
      if (!ruolo.children || ruolo.children.length === 0) continue;
      
      for (let j = 0; j < ruolo.children.length; j++) {
        const roleChild = ruolo.children[j];
        
        // Salta l'elemento TipoRuolo (è solo descrittivo)
        if (roleChild.tagName === 'TipoRuolo') continue;

        // Ora roleChild è un elemento come Destinatario, Mittente, ecc.
        // Cerca i soggetti (PF, PG, PAI, ecc.) dentro questo elemento
        if (!roleChild.children || roleChild.children.length === 0) continue;
        
        for (let k = 0; k < roleChild.children.length; k++) {
          const soggettoElement = roleChild.children[k];
          
          // Salta TipoRuolo se è qui
          if (soggettoElement.tagName === 'TipoRuolo') continue;
          
          const subjectId = await this.insertSubject(soggettoElement);
          
          if (subjectId) {
            // Associa soggetto al documento
            this.db.exec({
              sql: 'INSERT OR IGNORE INTO document_subject_association (document_id, subject_id) VALUES (?, ?)',
              bind: [documentId, subjectId]
            });
          }
        }
      }
    }
  }

  private async insertSubject(soggettoElement: Element): Promise<number | null> {
    if (!this.db) return null;

    const tagName = soggettoElement.tagName;
    
    // Inserisci nella tabella subject principale
    this.db.exec({
      sql: 'INSERT INTO subject DEFAULT VALUES'
    });

    // Recupera l'ID appena creato
    let subjectId = 0;
    this.db.exec({
      sql: 'SELECT last_insert_rowid() as id',
      callback: (row) => {
        subjectId = row[0] as number;
      }
    });

    if (subjectId === 0) return null;

    switch (tagName) {
      case 'PF': // Persona Fisica
        await this.insertSubjectPF(soggettoElement, subjectId);
        break;
      case 'PG': // Persona Giuridica
        await this.insertSubjectPG(soggettoElement, subjectId);
        break;
      case 'PAI': // Pubblica Amministrazione Interna
        await this.insertSubjectPAI(soggettoElement, subjectId);
        break;
      case 'PAE': // Pubblica Amministrazione Esterna
        await this.insertSubjectPAE(soggettoElement, subjectId);
        break;
      case 'AS': // Assegnatario
        await this.insertSubjectAS(soggettoElement, subjectId);
        break;
      case 'SW': // Sistema Software
        await this.insertSubjectSQ(soggettoElement, subjectId);
        break;
      default:
        console.warn('Unknown subject type:', tagName);
        return null;
    }

    return subjectId;
  }

  private async insertSubjectPF(element: Element, subjectId: number): Promise<void> {
    if (!this.db) return;

    const cognome = element.getElementsByTagName('Cognome')[0]?.textContent || '';
    const nome = element.getElementsByTagName('Nome')[0]?.textContent || '';
    const cf = element.getElementsByTagName('CodiceFiscale')[0]?.textContent || '';
    const indirizziTelematici = this.extractDigitalAddresses(element);

    this.db.exec({
      sql: `INSERT OR IGNORE INTO subject_pf (subject_id, cf, first_name, last_name, digital_addresses) 
            VALUES (?, ?, ?, ?, ?)`,
      bind: [subjectId, cf || null, nome, cognome, indirizziTelematici]
    });
  }

  private async insertSubjectPG(element: Element, subjectId: number): Promise<void> {
    if (!this.db) return;

    const denominazione = element.getElementsByTagName('Denominazione')[0]?.textContent || '';
    const sede = element.getElementsByTagName('Sede')[0]?.textContent || '';
    const pIva = element.getElementsByTagName('PartitaIVA')[0]?.textContent || '';
    const indirizziTelematici = this.extractDigitalAddresses(element);

    this.db.exec({
      sql: `INSERT OR IGNORE INTO subject_pg (subject_id, p_iva, company_name, office_name, digital_addresses) 
            VALUES (?, ?, ?, ?, ?)`,
      bind: [subjectId, pIva || null, denominazione, sede || null, indirizziTelematici]
    });
  }

  private async insertSubjectPAI(element: Element, subjectId: number): Promise<void> {
    if (!this.db) return;

    const codiceIPA = element.getElementsByTagName('CodiceIPA')[0];
    const amministrazione = codiceIPA?.getElementsByTagName('Amministrazione')[0]?.textContent || '';
    const aoo = codiceIPA?.getElementsByTagName('AOO')[0]?.textContent || '';
    const uor = codiceIPA?.getElementsByTagName('UOR')[0]?.textContent || '';
    const indirizziTelematici = this.extractDigitalAddresses(element);

    this.db.exec({
      sql: `INSERT OR IGNORE INTO subject_pai (subject_id, administration_ipa_name, administration_aoo_name, administration_uor_name, digital_addresses) 
            VALUES (?, ?, ?, ?, ?)`,
      bind: [subjectId, amministrazione, aoo, uor, indirizziTelematici]
    });
  }

  private async insertSubjectPAE(element: Element, subjectId: number): Promise<void> {
    if (!this.db) return;

    const denominazione = element.getElementsByTagName('Denominazione')[0]?.textContent || '';
    const sede = element.getElementsByTagName('Sede')[0]?.textContent || '';
    const indirizziTelematici = this.extractDigitalAddresses(element);

    this.db.exec({
      sql: `INSERT OR IGNORE INTO subject_pae (subject_id, administration_name, office_name, digital_addresses) 
            VALUES (?, ?, ?, ?)`,
      bind: [subjectId, denominazione, sede || null, indirizziTelematici]
    });
  }

  private async insertSubjectAS(element: Element, subjectId: number): Promise<void> {
    if (!this.db) return;

    const cognome = element.getElementsByTagName('Cognome')[0]?.textContent || '';
    const nome = element.getElementsByTagName('Nome')[0]?.textContent || '';
    const cf = element.getElementsByTagName('CodiceFiscale')[0]?.textContent || '';
    const denominazione = element.getElementsByTagName('Denominazione')[0]?.textContent || '';
    const sede = element.getElementsByTagName('Sede')[0]?.textContent || '';
    const indirizziTelematici = this.extractDigitalAddresses(element);

    this.db.exec({
      sql: `INSERT OR IGNORE INTO subject_as (subject_id, first_name, last_name, cf, organization_name, office_name, digital_addresses) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bind: [subjectId, nome || null, cognome || null, cf || null, denominazione, sede, indirizziTelematici]
    });
  }

  private async insertSubjectSQ(element: Element, subjectId: number): Promise<void> {
    if (!this.db) return;

    const sistemaSoftware = element.getElementsByTagName('SistemaSoftware')[0]?.textContent || 
                           element.getElementsByTagName('Denominazione')[0]?.textContent || '';

    this.db.exec({
      sql: `INSERT OR IGNORE INTO subject_sq (subject_id, system_name) VALUES (?, ?)`,
      bind: [subjectId, sistemaSoftware]
    });
  }

  private extractDigitalAddresses(element: Element): string {
    const addresses: string[] = [];
    const indirizziTelematici = element.getElementsByTagName('IndirizziTelematici')[0] || 
                                element.getElementsByTagName('IndirizzoTelematico');
    
    if (indirizziTelematici) {
      if (indirizziTelematici.children) {
        for (let i = 0; i < indirizziTelematici.children.length; i++) {
          const addr = indirizziTelematici.children[i].textContent?.trim();
          if (addr) addresses.push(addr);
        }
      } else {
        const addr = indirizziTelematici.textContent?.trim();
        if (addr) addresses.push(addr);
      }
    }
    
    return addresses.join(';');
  }
}