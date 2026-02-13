"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// indexer-main.ts - Main process indexer using Node.js fs
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const xmldom_1 = require("xmldom");
class IndexerMain {
    db;
    dipRootPath;
    constructor(db, dipRootPath) {
        this.db = db;
        this.dipRootPath = dipRootPath;
    }
    async indexDip() {
        await this.readDipIndex();
    }
    async readDipIndex() {
        try {
            const entries = fs.readdirSync(this.dipRootPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.includes('DiPIndex')) {
                    const filePath = path.join(this.dipRootPath, entry.name);
                    const xmlContent = fs.readFileSync(filePath, 'utf-8');
                    await this.parseDipIndexXml(xmlContent);
                }
            }
        }
        catch (err) {
            console.error('[Indexer] Error reading DIP index:', err);
            throw err;
        }
    }
    async parseDipIndexXml(xmlContent) {
        if (!this.db) {
            throw new Error('Database not initialized');
        }
        const parser = new xmldom_1.DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
        // Check for parsing errors
        const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            throw new Error('XML parsing error: ' + parserError.textContent);
        }
        try {
            // Extract archival process UUID - try different XML structures
            const processUUIDs = Array.from(xmlDoc.getElementsByTagName('AiP')).map(aip => aip.getAttribute('uuid')).filter((uuid) => uuid !== null);
            for (const processUUID of processUUIDs) {
                await this.insertArchivalProcess(processUUID);
            }
            // Process all DocumentClass elements
            const documentClasses = xmlDoc.getElementsByTagName('DocumentClass');
            for (let i = 0; i < documentClasses.length; i++) {
                await this.processDocumentClass(documentClasses[i]);
            }
        }
        catch (error) {
            console.error('[Indexer] Error parsing DIP index XML:', error);
            throw error;
        }
    }
    insertArchivalProcess(uuid) {
        if (!this.db)
            throw new Error('Database not initialized');
        const sql = `INSERT OR IGNORE INTO archival_process (uuid) VALUES (?)`;
        this.db.exec(sql, [uuid]);
    }
    processDocumentClass(docClassElement) {
        if (!this.db)
            throw new Error('Database not initialized');
        const className = docClassElement.getAttribute('name') || '';
        console.log("Processing DocumentClass:", className);
        // Check if class already exists first
        const checkSql = `SELECT id FROM document_class WHERE class_name = ?`;
        let result = this.db.executeQuery(checkSql, [className]);
        let documentClassId;
        if (result.length > 0) {
            documentClassId = result[0].id;
        }
        else {
            // Insert only if it doesn't exist
            const insertClassSql = `INSERT INTO document_class (class_name) VALUES (?)`;
            this.db.exec(insertClassSql, [className]);
            result = this.db.executeQuery(checkSql, [className]);
            documentClassId = result.length > 0 ? result[0].id : 0;
        }
        if (documentClassId === 0) {
            throw new Error(`Could not retrieve document_class id for ${className}`);
        }
        // Process all AiP elements
        const aips = docClassElement.getElementsByTagName('AiP');
        for (let i = 0; i < aips.length; i++) {
            this.processAiP(aips[i], documentClassId);
        }
        return documentClassId;
    }
    processAiP(aipElement, documentClassId) {
        if (!this.db)
            throw new Error('Database not initialized');
        const aipUUID = aipElement.getAttribute('uuid') || '';
        const aipRoot = (aipElement.getElementsByTagName('AiPRoot')[0]?.textContent || '').trim();
        // Insert AiP
        const insertAipSql = `INSERT OR IGNORE INTO aip (uuid, document_class_id, archival_process_uuid, root_path) VALUES (?, ?, ?, ?)`;
        this.db.exec(insertAipSql, [aipUUID, documentClassId, aipUUID, aipRoot]);
        // Clean aipRoot path (remove leading ./)
        const cleanAipRoot = aipRoot.replace(/^\.\//, '');
        // Process Documents
        const documents = aipElement.getElementsByTagName('Document');
        for (let i = 0; i < documents.length; i++) {
            this.processDocument(documents[i], aipUUID, cleanAipRoot);
        }
    }
    processDocument(docElement, aipUUID, currentPath) {
        if (!this.db)
            throw new Error('Database not initialized');
        // const docUUID = docElement.getAttribute('uuid') || '';
        const docPath = (docElement.getElementsByTagName('DocumentPath')[0]?.textContent || '').trim();
        // Insert Document
        const insertDocSql = `INSERT OR IGNORE INTO document (root_path, aip_uuid) VALUES (?, ?)`;
        this.db.exec(insertDocSql, [docPath, aipUUID]);
        // Get the document id
        const getDocIdSql = `SELECT id FROM document WHERE root_path = ? AND aip_uuid = ?`;
        const result = this.db.executeQuery(getDocIdSql, [docPath, aipUUID]);
        const documentId = result.length > 0 ? result[0].id : 0;
        if (documentId === 0) {
            console.warn(`Could not retrieve document id for ${docPath}`);
            return;
        }
        // Build the document folder path
        const cleanDocPath = docPath.replace(/^\.\//, '');
        const documentFolderPath = path.join(currentPath, cleanDocPath);
        // Process Files
        const filesElement = docElement.getElementsByTagName('Files')[0];
        if (filesElement) {
            this.processFiles(filesElement, documentId, documentFolderPath);
        }
    }
    processFiles(filesElement, documentId, currentPath) {
        if (!this.db)
            throw new Error('Database not initialized');
        // Process Metadata file (extract metadata but don't index the file itself)
        const metadata = filesElement.getElementsByTagName('Metadata')[0];
        const metadataPath = (metadata?.textContent || '').trim();
        // Process Primary file
        const primary = filesElement.getElementsByTagName('Primary')[0];
        if (primary) {
            const primaryPath = (primary.textContent || '').trim();
            this.insertFile(currentPath, primaryPath, true, documentId);
        }
        // Process Attachments
        const attachments = filesElement.getElementsByTagName('Attachments');
        for (let i = 0; i < attachments.length; i++) {
            const attachmentPath = (attachments[i].textContent || '').trim();
            this.insertFile(currentPath, attachmentPath, false, documentId);
        }
        // Process metadata XML file to extract document properties
        if (metadataPath) {
            this.processMetadataFile(`${currentPath}/${metadataPath.replace(/^\.\//, '')}`, documentId);
        }
    }
    insertFile(root_path, relativePath, isMain, documentId) {
        if (!this.db)
            throw new Error('Database not initialized');
        const sql = `INSERT OR IGNORE INTO file (relative_path, is_main, document_id, root_path) VALUES (?, ?, ?, ?)`;
        this.db.exec(sql, [relativePath, isMain ? 1 : 0, documentId, root_path + '/' + relativePath.replace(/^\.\//, '')]);
    }
    getFilePath(relativePath) {
        // Normalize path
        const cleaned = (relativePath || '')
            .normalize('NFC')
            .replace(/\\/g, '/')
            .trim()
            .replace(/^\.\//, '') // Remove leading ./
            .replace(/^\/+|\/+$/g, '') // Remove leading/trailing /
            .replace(/\/{2,}/g, '/'); // Remove double slashes
        if (!cleaned) {
            return null;
        }
        const fullPath = path.join(this.dipRootPath, cleaned);
        // Check if file exists
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
        console.log(`File not found at expected path: ${fullPath}`);
        // Try case-insensitive search
        const parts = cleaned.split('/');
        let currentPath = this.dipRootPath;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            let found = false;
            for (const entry of entries) {
                if (entry.name.toLowerCase() === part.toLowerCase()) {
                    currentPath = path.join(currentPath, entry.name);
                    found = true;
                    break;
                }
            }
            if (!found) {
                console.warn(`Path not found: ${relativePath}`);
                return null;
            }
        }
        return currentPath;
    }
    processMetadataFile(relativePath, documentId) {
        console.log('Attempting to access metadata at:', relativePath);
        const filePath = this.getFilePath(relativePath);
        if (!filePath) {
            console.warn('Metadata file not found:', relativePath);
            return;
        }
        let content;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        }
        catch (err) {
            console.error('Error reading metadata file:', err);
            return;
        }
        const parser = new xmldom_1.DOMParser();
        const xmlDoc = parser.parseFromString(content, "application/xml");
        // Check for parsing errors
        const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
        if (parserError) {
            console.error('XML parsing error:', parserError.textContent);
            return;
        }
        // Extract and insert metadata
        const ChiaveDescrittiva = xmlDoc.getElementsByTagName('ChiaveDescrittiva')[0];
        if (ChiaveDescrittiva) {
            const childs = ChiaveDescrittiva.childNodes;
            let value = '';
            Array.from(childs).forEach(child => {
                if (child.nodeType === 1) { // Element node
                    value += child.textContent + ' ';
                }
            });
            this.insertMetadata('ChiaveDescrittiva', value.trim(), documentId, 'string');
        }
        const IndiceDiClassificazione = xmlDoc.getElementsByTagName('IndiceDiClassificazione')[0];
        const Classificazione = xmlDoc.getElementsByTagName('Classificazione')[0];
        const Descrizione = Classificazione?.getElementsByTagName('Descrizione')[0];
        const PianoDiClassificazione = xmlDoc.getElementsByTagName('PianoDiClassificazione')[0];
        this.insertMetadata('IndiceDiClassificazione', IndiceDiClassificazione?.textContent || '', documentId, 'string');
        this.insertMetadata('Descrizione', Descrizione?.textContent || '', documentId, 'string');
        this.insertMetadata('PianoDiClassificazione', PianoDiClassificazione?.textContent || '', documentId, 'string');
        const TempoDiConservazione = xmlDoc.getElementsByTagName('TempoDiConservazione')[0];
        this.insertMetadata('TempoDiConservazione', TempoDiConservazione?.textContent || '', documentId, 'number');
        const Note = xmlDoc.getElementsByTagName('Note')[0];
        this.insertMetadata('Note', Note?.textContent || '', documentId, 'string');
        // Extract DatiDiRegistrazione
        const datiReg = xmlDoc.getElementsByTagName('DatiDiRegistrazione')[0];
        if (datiReg) {
            this.insertMetadata('TipologiaDiFlusso', datiReg.getElementsByTagName('TipologiaDiFlusso')[0]?.textContent || '', documentId, 'string');
            const repertorio = datiReg.getElementsByTagName('Repertorio_Registro')[0];
            if (repertorio) {
                this.insertMetadata('TipoRegistro', repertorio.getElementsByTagName('TipoRegistro')[0]?.textContent || '', documentId, 'string');
                this.insertMetadata('DataRegistrazioneDocumento', repertorio.getElementsByTagName('DataRegistrazioneDocumento')[0]?.textContent || '', documentId, 'date');
                this.insertMetadata('NumeroRegistrazioneDocumento', repertorio.getElementsByTagName('NumeroRegistrazioneDocumento')[0]?.textContent || '', documentId, 'string');
                this.insertMetadata('CodiceRegistro', repertorio.getElementsByTagName('CodiceRegistro')[0]?.textContent || '', documentId, 'string');
            }
        }
        // Process Impronte (hash) per file - main document + attachments
        this.processImpronte(xmlDoc, documentId);
        // Additional generic metadata
        this.extractOptionalMetadata(xmlDoc, documentId, 'DataFattura', 'string');
        this.extractOptionalMetadata(xmlDoc, documentId, 'NumeroFattura', 'string');
        this.extractOptionalMetadata(xmlDoc, documentId, 'CodiceFiscale', 'string');
        this.extractOptionalMetadata(xmlDoc, documentId, 'Nome', 'string');
        const Version = xmlDoc.getElementsByTagName('Version')[0] ||
            xmlDoc.getElementsByTagName('VersioneDelDocumento')[0];
        if (Version) {
            this.insertMetadata('Version', Version.textContent || '', documentId, 'string');
        }
        this.extractOptionalMetadata(xmlDoc, documentId, 'CategoriaProdotto', 'string');
        const IdAggregazione = xmlDoc.getElementsByTagName('IdAggregazione')[0] ||
            xmlDoc.getElementsByTagName('IdAgg')[0];
        if (IdAggregazione) {
            this.insertMetadata('IdAggregazione', IdAggregazione.textContent || '', documentId, 'string');
        }
        const ProdottoSoftware = xmlDoc.getElementsByTagName('ProdottoSoftware')[0];
        if (ProdottoSoftware) {
            const nomeProdotto = ProdottoSoftware.getElementsByTagName('NomeProdotto')[0]?.textContent ||
                ProdottoSoftware.getElementsByTagName('Prodotto')[0]?.textContent || '';
            const versioneProdotto = ProdottoSoftware.getElementsByTagName('VersioneProdotto')[0]?.textContent || '';
            const produttore = ProdottoSoftware.getElementsByTagName('Produttore')[0]?.textContent || '';
            this.insertMetadata('NomeProdotto', nomeProdotto, documentId, 'string');
            this.insertMetadata('VersioneProdotto', versioneProdotto, documentId, 'string');
            this.insertMetadata('Produttore', produttore, documentId, 'string');
        }
        // Extract Formato
        const formato = xmlDoc.getElementsByTagName('Formato')[0];
        this.insertMetadata('Formato', formato?.textContent || '', documentId, 'string');
        // Extract verification fields
        const verifica = xmlDoc.getElementsByTagName('Verifica')[0];
        if (verifica) {
            this.insertMetadata('FirmatoDigitalmente', verifica.getElementsByTagName('FirmatoDigitalmente')[0]?.textContent || '', documentId, 'string');
            this.insertMetadata('MarcaturaTemporale', verifica.getElementsByTagName('MarcaturaTemporale')[0]?.textContent || '', documentId, 'string');
        }
        // Extract document-level fields
        this.extractOptionalMetadata(xmlDoc, documentId, 'ModalitaDiFormazione', 'string');
        this.extractOptionalMetadata(xmlDoc, documentId, 'TipologiaDocumentale', 'string');
        this.extractOptionalMetadata(xmlDoc, documentId, 'NomeDelDocumento', 'string');
        this.extractOptionalMetadata(xmlDoc, documentId, 'Riservato', 'string');
        this.extractOptionalMetadata(xmlDoc, documentId, 'ModalitaPagamento', 'string');
        // Process Soggetti (Subjects)
        this.processSoggetti(xmlDoc, documentId);
        // Process Fasi (Phases)
        this.processFasi(xmlDoc, documentId);
        console.log('Metadata processed for document ID:', documentId);
    }
    insertMetadata(key, value, documentId, metaType = 'string', fileId = null) {
        if (!this.db)
            return;
        // Don't insert empty/null values
        if (!value || value.trim() === '')
            return;
        if (fileId) {
            const query = 'INSERT OR IGNORE INTO metadata(meta_key, meta_value, document_id, file_id, meta_type) VALUES (?, ?, ?, ?, ?)';
            this.db.exec(query, [key, value, documentId, fileId, metaType]);
        }
        else {
            const query = 'INSERT OR IGNORE INTO metadata(meta_key, meta_value, document_id, meta_type) VALUES (?, ?, ?, ?)';
            this.db.exec(query, [key, value, documentId, metaType]);
        }
    }
    extractOptionalMetadata(xmlDoc, documentId, tagName, metaType = 'string') {
        const element = xmlDoc.getElementsByTagName(tagName)[0];
        if (element) {
            this.insertMetadata(tagName, element.textContent || '', documentId, metaType);
        }
    }
    /**
     * Extract Impronta (hash) for ALL files: main document + each attachment.
     * Maps UUID → Impronta from DocumentoInformatico/Allegati, then UUID → file path
     * from ArchimemoData, and finally looks up file_id in the database.
     */
    processImpronte(xmlDoc, documentId) {
        if (!this.db)
            return;
        const improntaMap = new Map(); // UUID → { impronta, algoritmo }
        const documentoInformatico = xmlDoc.getElementsByTagName('DocumentoInformatico')[0];
        if (!documentoInformatico)
            return;
        // 1. Main document's hash from DocumentoInformatico > IdDoc
        const mainIdDoc = documentoInformatico.getElementsByTagName('IdDoc')[0];
        if (mainIdDoc) {
            const improntaCripto = mainIdDoc.getElementsByTagName('ImprontaCrittograficaDelDocumento')[0];
            if (improntaCripto) {
                const impronta = improntaCripto.getElementsByTagName('Impronta')[0]?.textContent || '';
                const algoritmo = improntaCripto.getElementsByTagName('Algoritmo')[0]?.textContent || '';
                const identificativo = mainIdDoc.getElementsByTagName('Identificativo')[0]?.textContent || '';
                if (identificativo && impronta) {
                    improntaMap.set(identificativo, { impronta, algoritmo });
                }
            }
        }
        // 2. Attachment hashes from Allegati > IndiceAllegati > IdDoc
        const allegatiElement = documentoInformatico.getElementsByTagName('Allegati')[0];
        if (allegatiElement) {
            const indiceAllegati = allegatiElement.getElementsByTagName('IndiceAllegati');
            for (let i = 0; i < indiceAllegati.length; i++) {
                const idDoc = indiceAllegati[i].getElementsByTagName('IdDoc')[0];
                if (idDoc) {
                    const improntaCripto = idDoc.getElementsByTagName('ImprontaCrittograficaDelDocumento')[0];
                    if (improntaCripto) {
                        const impronta = improntaCripto.getElementsByTagName('Impronta')[0]?.textContent || '';
                        const algoritmo = improntaCripto.getElementsByTagName('Algoritmo')[0]?.textContent || '';
                        const identificativo = idDoc.getElementsByTagName('Identificativo')[0]?.textContent || '';
                        if (identificativo && impronta) {
                            improntaMap.set(identificativo, { impronta, algoritmo });
                        }
                    }
                }
            }
        }
        console.log(`[Indexer] Found ${improntaMap.size} Impronte (main + attachments)`);
        // 3. Map UUID → file path from ArchimemoData, then look up file_id
        const archimemoData = xmlDoc.getElementsByTagName('ArchimemoData')[0];
        if (archimemoData) {
            const fileInfos = archimemoData.getElementsByTagName('FileInformation');
            for (let i = 0; i < fileInfos.length; i++) {
                const fileUUID = fileInfos[i].getElementsByTagName('FileUUID')[0]?.textContent || '';
                const fileLocalName = fileInfos[i].getElementsByTagName('FileLocalName')[0]?.textContent || '';
                if (!fileUUID || !fileLocalName)
                    continue;
                const improntaData = improntaMap.get(fileUUID);
                if (!improntaData)
                    continue;
                // Try to find the file in the database by relative_path
                let fileId = null;
                const candidates = [fileLocalName, fileLocalName.replace(/^\.\//, '')];
                for (const candidate of candidates) {
                    const fileResult = this.db.executeQuery('SELECT id FROM file WHERE relative_path = ? AND document_id = ?', [candidate, documentId]);
                    if (fileResult.length > 0) {
                        fileId = fileResult[0].id;
                        break;
                    }
                }
                // Insert hash with file_id
                this.insertMetadata('Impronta', improntaData.impronta, documentId, 'string', fileId);
                if (improntaData.algoritmo) {
                    this.insertMetadata('Algoritmo', improntaData.algoritmo, documentId, 'string', fileId);
                }
                console.log(`[Indexer] Impronta stored for file UUID=${fileUUID}, file_id=${fileId}`);
            }
        }
        else {
            // Fallback: no ArchimemoData, store just the main document's hash at document level
            const firstEntry = improntaMap.values().next().value;
            if (firstEntry) {
                this.insertMetadata('Impronta', firstEntry.impronta, documentId, 'string');
                if (firstEntry.algoritmo) {
                    this.insertMetadata('Algoritmo', firstEntry.algoritmo, documentId, 'string');
                }
            }
        }
    }
    processFasi(xmlDoc, documentId) {
        if (!this.db)
            return;
        const proceduraElement = xmlDoc.getElementsByTagName('ProceduraAmministrativa')[0] ||
            xmlDoc.getElementsByTagName('ProcedimentoAmministrativo')[0];
        if (!proceduraElement)
            return;
        const catalogUri = proceduraElement.getElementsByTagName('CatalogoURI')[0]?.textContent || '';
        const titolo = proceduraElement.getElementsByTagName('Titolo')[0]?.textContent || '';
        const oggettoInteresse = proceduraElement.getElementsByTagName('OggettoDiInteresse')[0]?.textContent || '';
        this.db.exec('INSERT INTO administrative_procedure (catalog_uri, title, subject_of_interest) VALUES (?, ?, ?)', [catalogUri, titolo, oggettoInteresse || null]);
        const result = this.db.executeQuery('SELECT last_insert_rowid() as id');
        const procedureId = result.length > 0 ? result[0].id : 0;
        if (procedureId === 0)
            return;
        // Update document with aggregation if exists
        const aggElement = xmlDoc.getElementsByTagName('Agg')[0];
        if (aggElement) {
            const tipoAgg = aggElement.getElementsByTagName('TipoAgg')[0]?.textContent || '';
            this.db.exec('INSERT INTO document_aggregation (procedure_id, type) VALUES (?, ?)', [procedureId, tipoAgg]);
            const aggResult = this.db.executeQuery('SELECT last_insert_rowid() as id');
            const aggregationId = aggResult.length > 0 ? aggResult[0].id : 0;
            if (aggregationId > 0) {
                this.db.exec('UPDATE document SET aggregation_id = ? WHERE id = ?', [aggregationId, documentId]);
            }
        }
        // Extract and insert phases
        const fasiElements = proceduraElement.getElementsByTagName('Fase');
        for (let i = 0; i < fasiElements.length; i++) {
            this.insertFase(fasiElements[i], procedureId);
        }
    }
    insertFase(faseElement, procedureId) {
        if (!this.db)
            return;
        const tipo = faseElement.getElementsByTagName('TipoFase')[0]?.textContent ||
            faseElement.getElementsByTagName('Tipo')[0]?.textContent || '';
        const dataInizio = faseElement.getElementsByTagName('DataInizio')[0]?.textContent ||
            faseElement.getElementsByTagName('DataApertura')[0]?.textContent || '';
        const dataFine = faseElement.getElementsByTagName('DataFine')[0]?.textContent ||
            faseElement.getElementsByTagName('DataChiusura')[0]?.textContent || null;
        if (tipo && dataInizio) {
            this.db.exec('INSERT INTO phase (type, start_date, end_date, administrative_procedure_id) VALUES (?, ?, ?, ?)', [tipo, dataInizio, dataFine, procedureId]);
        }
    }
    processSoggetti(xmlDoc, documentId) {
        if (!this.db)
            return;
        const soggettiElement = xmlDoc.getElementsByTagName('Soggetti')[0];
        if (!soggettiElement)
            return;
        const ruoli = soggettiElement.getElementsByTagName('Ruolo');
        for (let i = 0; i < ruoli.length; i++) {
            const ruolo = ruoli[i];
            // const tipoRuolo = ruolo.getElementsByTagName('TipoRuolo')[0]?.textContent || '';
            const soggettoElements = [
                ruolo.getElementsByTagName('PersonaFisica')[0] || ruolo.getElementsByTagName('PF')[0],
                ruolo.getElementsByTagName('PersonaGiuridica')[0] || ruolo.getElementsByTagName('PG')[0],
                ruolo.getElementsByTagName('PAI')[0],
                ruolo.getElementsByTagName('PAE')[0],
                ruolo.getElementsByTagName('AS')[0],
                ruolo.getElementsByTagName('SQ')[0]
            ].filter((el) => el != null);
            for (const soggettoElement of soggettoElements) {
                const subjectId = this.insertSubject(soggettoElement);
                if (subjectId) {
                    this.db.exec('INSERT OR IGNORE INTO document_subject_association (document_id, subject_id) VALUES (?, ?)', [documentId, subjectId]);
                }
            }
        }
    }
    insertSubject(soggettoElement) {
        if (!this.db)
            return null;
        const tagName = soggettoElement.tagName;
        this.db.exec('INSERT INTO subject DEFAULT VALUES');
        const result = this.db.executeQuery('SELECT last_insert_rowid() as id');
        const subjectId = result.length > 0 ? result[0].id : 0;
        if (subjectId === 0)
            return null;
        switch (tagName) {
            case 'PersonaFisica':
            case 'PF':
                this.insertSubjectPF(soggettoElement, subjectId);
                break;
            case 'PersonaGiuridica':
            case 'PG':
                this.insertSubjectPG(soggettoElement, subjectId);
                break;
            case 'PAI':
                this.insertSubjectPAI(soggettoElement, subjectId);
                break;
            case 'PAE':
                this.insertSubjectPAE(soggettoElement, subjectId);
                break;
            case 'AS':
                this.insertSubjectAS(soggettoElement, subjectId);
                break;
            case 'SQ':
                this.insertSubjectSQ(soggettoElement, subjectId);
                break;
            default:
                console.warn('Unknown subject type:', tagName);
        }
        return subjectId;
    }
    insertSubjectPF(element, subjectId) {
        if (!this.db)
            return;
        const cognome = element.getElementsByTagName('Cognome')[0]?.textContent || '';
        const nome = element.getElementsByTagName('Nome')[0]?.textContent || '';
        const cf = element.getElementsByTagName('CodiceFiscale')[0]?.textContent || '';
        const indirizziTelematici = this.extractDigitalAddresses(element);
        this.db.exec(`INSERT OR IGNORE INTO subject_pf (subject_id, cf, first_name, last_name, digital_addresses) 
       VALUES (?, ?, ?, ?, ?)`, [subjectId, cf || null, nome, cognome, indirizziTelematici]);
    }
    insertSubjectPG(element, subjectId) {
        if (!this.db)
            return;
        const denominazione = element.getElementsByTagName('DenominazioneOrganizzazione')[0]?.textContent ||
            element.getElementsByTagName('Denominazione')[0]?.textContent || '';
        const piva = element.getElementsByTagName('CodiceFiscale_PartitaIva')[0]?.textContent ||
            element.getElementsByTagName('PartitaIVA')[0]?.textContent || '';
        const ufficio = element.getElementsByTagName('DenominazioneUfficio')[0]?.textContent ||
            element.getElementsByTagName('Ufficio')[0]?.textContent || '';
        const indirizziTelematici = this.extractDigitalAddresses(element);
        this.db.exec(`INSERT OR IGNORE INTO subject_pg (subject_id, p_iva, company_name, office_name, digital_addresses) 
       VALUES (?, ?, ?, ?, ?)`, [subjectId, piva || null, denominazione, ufficio, indirizziTelematici]);
    }
    insertSubjectPAI(element, subjectId) {
        if (!this.db)
            return;
        const codiceIPA = element.getElementsByTagName('CodiceIPA')[0]?.textContent || '';
        const codiceAOO = element.getElementsByTagName('CodiceAOO')[0]?.textContent || '';
        const codiceUOR = element.getElementsByTagName('CodiceUOR')[0]?.textContent || '';
        const indirizziTelematici = this.extractDigitalAddresses(element);
        this.db.exec(`INSERT OR IGNORE INTO subject_pai (subject_id, administration_ipa_name, administration_aoo_name, administration_uor_name, digital_addresses) 
       VALUES (?, ?, ?, ?, ?)`, [subjectId, codiceIPA, codiceAOO, codiceUOR, indirizziTelematici]);
    }
    insertSubjectPAE(element, subjectId) {
        if (!this.db)
            return;
        const denominazione = element.getElementsByTagName('Denominazione')[0]?.textContent || '';
        const ufficio = element.getElementsByTagName('Ufficio')[0]?.textContent || '';
        const indirizziTelematici = this.extractDigitalAddresses(element);
        this.db.exec(`INSERT OR IGNORE INTO subject_pae (subject_id, administration_name, office_name, digital_addresses) 
       VALUES (?, ?, ?, ?)`, [subjectId, denominazione, ufficio, indirizziTelematici]);
    }
    insertSubjectAS(element, subjectId) {
        if (!this.db)
            return;
        const cognome = element.getElementsByTagName('Cognome')[0]?.textContent || '';
        const nome = element.getElementsByTagName('Nome')[0]?.textContent || '';
        const cf = element.getElementsByTagName('CodiceFiscale')[0]?.textContent || '';
        const organizzazione = element.getElementsByTagName('Organizzazione')[0]?.textContent || '';
        const ufficio = element.getElementsByTagName('Ufficio')[0]?.textContent || '';
        const indirizziTelematici = this.extractDigitalAddresses(element);
        this.db.exec(`INSERT OR IGNORE INTO subject_as (subject_id, first_name, last_name, cf, organization_name, office_name, digital_addresses) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [subjectId, nome, cognome, cf || null, organizzazione, ufficio, indirizziTelematici]);
    }
    insertSubjectSQ(element, subjectId) {
        if (!this.db)
            return;
        const nomeSistema = element.getElementsByTagName('NomeSistema')[0]?.textContent ||
            element.getElementsByTagName('Descrizione')[0]?.textContent || '';
        this.db.exec(`INSERT OR IGNORE INTO subject_sq (subject_id, system_name) 
       VALUES (?, ?)`, [subjectId, nomeSistema]);
    }
    extractDigitalAddresses(element) {
        const addresses = [];
        // Try structured format: IndirizziTelematici > Email | PEC
        const indirizziElement = element.getElementsByTagName('IndirizziTelematici')[0];
        if (indirizziElement) {
            const emails = indirizziElement.getElementsByTagName('Email');
            const pecs = indirizziElement.getElementsByTagName('PEC');
            for (let i = 0; i < emails.length; i++) {
                addresses.push(emails[i].textContent || '');
            }
            for (let i = 0; i < pecs.length; i++) {
                addresses.push(pecs[i].textContent || '');
            }
        }
        // Try flat format: IndirizziDigitaliDiRiferimento (single tag with text)
        const indirizziDigitali = element.getElementsByTagName('IndirizziDigitaliDiRiferimento');
        for (let i = 0; i < indirizziDigitali.length; i++) {
            const addr = (indirizziDigitali[i].textContent || '').trim();
            if (addr)
                addresses.push(addr);
        }
        return addresses.join(', ');
    }
}
exports.default = IndexerMain;
//# sourceMappingURL=indexer-main.js.map