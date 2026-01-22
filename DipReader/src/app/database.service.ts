import { Injectable } from '@angular/core';
import { FileNode } from './dip-reader.service';
import { FilterManager, Filter } from './filter-manager';

/**
 * Servizio per la gestione del database SQLite tramite Web Worker
 * Comunica con sqlite-db.worker.ts per tutte le operazioni sul database
 */
@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private worker: Worker | null = null;
  private dbReady = false;
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();
  private currentDipUUID: string | null = null;
  private availableDips: string[] = [];

  constructor() {
    this.initWorker();
  }

  /**
   * Inizializza il worker e il database SQLite
   */
  private initWorker(): void {
    this.worker = new Worker(new URL('./sqlite-db.worker', import.meta.url), { type: 'module' });

    this.worker.onmessage = ({ data }) => {
      if (data.type === 'READY') {
        console.log('[DatabaseService] Database pronto:', data.payload);
        this.dbReady = true;
        // Carica la lista dei database disponibili
        this.loadAvailableDips();
      } else if (data.type === 'INDEXED') {
        console.log('[DatabaseService] Indicizzazione completata per:', data.dipUUID);
        this.currentDipUUID = data.dipUUID;
        this.loadAvailableDips();
      } else if (data.type === 'DB_SWITCHED') {
        console.log('[DatabaseService] Cambio database completato:', data.dipUUID);
        this.currentDipUUID = data.dipUUID;
      } else if (data.type === 'DB_LIST') {
        this.availableDips = data.databases;
        console.log('[DatabaseService] Database disponibili:', this.availableDips);
      } else if (data.type === 'DB_DELETED') {
        console.log('[DatabaseService] Database eliminato:', data.dipUUID);
        if (this.currentDipUUID === data.dipUUID) {
          this.currentDipUUID = null;
        }
        this.loadAvailableDips();
      } else if (data.type === 'QUERY_RESULT') {
        // Risolve la promise per la query corrispondente
        const request = this.pendingRequests.get(data.id);
        if (request) {
          request.resolve(data.result);
          this.pendingRequests.delete(data.id);
        }
      } else if (data.type === 'DB_BLOB') {
        // Download del database esportato
        const a = document.createElement('a');
        a.href = data.url;
        a.download = data.filename || 'dip_debug.sqlite3';
        a.click();
        URL.revokeObjectURL(data.url);
      } else if (data.type === 'ERROR') {
        console.error('[DatabaseService] Errore dal worker:', data.error);
        const request = this.pendingRequests.get(data.id);
        if (request) {
          request.reject(new Error(data.error));
          this.pendingRequests.delete(data.id);
        }
      }
    };

    // Inizializza il database
    this.worker.postMessage({ type: 'INIT' });
  }

  /**
   * Avvia l'indicizzazione di una directory DIP
   */
  async indexDirectory(): Promise<void> {
    if (!this.worker) throw new Error('Worker non inizializzato');

    console.log('[DatabaseService] Selezione directory...');
    const rootHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker();

    const keys = rootHandle.keys();
    let key = await keys.next();
    let found = false;
    while (!key.done && !found) {
      if (key.value.includes('DiPIndex')) {
        found = true;
      } else {
        key = await keys.next();
      }
    }
    if (!found) {
      throw new Error('La directory selezionata non contiene un file DiPIndex.xml valido.');
    }
    let dipUUID = key.value;
    if (dipUUID) {
      // Estrai solo la parte UUID dal nome file (es: dip.20251111.0413d8ee-8e82-4331-864e-7f8098bcc419)
      const uuidMatch = dipUUID.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      dipUUID = uuidMatch ? uuidMatch[0] : undefined;
    }
    if (!dipUUID) {
      throw new Error('Impossibile estrarre il DIP UUID dal nome del file DiPIndex.');
    }

    return new Promise((resolve, reject) => {
      const handleIndexed = ({ data }: MessageEvent) => {
        if (data.type === 'INDEXED') {
          this.worker?.removeEventListener('message', handleIndexed);
          resolve();
        } else if (data.type === 'ERROR') {
          this.worker?.removeEventListener('message', handleIndexed);
          reject(new Error(data.error));
        }
      };

      this.worker?.addEventListener('message', handleIndexed);
      console.log('dipUUID:', dipUUID);
      this.worker?.postMessage({ type: 'INDEX', handle: rootHandle, dipUUID: dipUUID });
    });
  }

  /**
   * Esegue una query SQL sul database tramite il worker
   */
  private async executeQuery<T = any>(sql: string, params: any[] = []): Promise<T> {
    if (!this.worker) throw new Error('Worker non inizializzato');
    if (!this.dbReady) throw new Error('Database non ancora pronto');

    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      this.worker!.postMessage({
        type: 'QUERY',
        id,
        sql,
        params
      });

      // Timeout dopo 30 secondi
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Query timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Verifica se il database è pronto per le query
   */
  isDbReady(): boolean {
    return this.dbReady && this.currentDipUUID !== null;
  }

  /**
   * Restituisce l'UUID del DIP corrente
   */
  getCurrentDipUUID(): string | null {
    return this.currentDipUUID;
  }

  /**
   * Restituisce la lista dei DIP disponibili
   */
  getAvailableDips(): string[] {
    return [...this.availableDips];
  }

  /**
   * Carica la lista dei database disponibili
   */
  private loadAvailableDips(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'LIST_DBS' });
    }
  }

  /**
   * Cambia il database attivo
   */
  async switchDatabase(dipUUID: string): Promise<void> {
    if (!this.worker) throw new Error('Worker non inizializzato');

    return new Promise((resolve, reject) => {
      const handleSwitched = ({ data }: MessageEvent) => {
        if (data.type === 'DB_SWITCHED') {
          this.worker?.removeEventListener('message', handleSwitched);
          this.currentDipUUID = data.dipUUID;
          resolve();
        } else if (data.type === 'ERROR') {
          this.worker?.removeEventListener('message', handleSwitched);
          reject(new Error(data.error));
        }
      };

      this.worker?.addEventListener('message', handleSwitched);
      this.worker?.postMessage({ type: 'SWITCH_DB', dipUUID });
    });
  }

  /**
   * Elimina un database DIP
   */
  async deleteDatabase(dipUUID: string): Promise<boolean> {
    if (!this.worker) throw new Error('Worker non inizializzato');

    return new Promise((resolve, reject) => {
      const handleDeleted = ({ data }: MessageEvent) => {
        if (data.type === 'DB_DELETED') {
          this.worker?.removeEventListener('message', handleDeleted);
          resolve(data.success);
        } else if (data.type === 'ERROR') {
          this.worker?.removeEventListener('message', handleDeleted);
          reject(new Error(data.error));
        }
      };

      this.worker?.addEventListener('message', handleDeleted);
      this.worker?.postMessage({ type: 'DELETE_DB', dipUUID });
    });
  }

  async getTreeFromDb(): Promise<FileNode[]> {
    // Query che recupera la gerarchia completa: DocumentClass -> AiP -> Document -> File
    const rows = await this.executeQuery<{
      class_name: string;
      aip_uuid: string;
      document_root_path: string;
      file_relative_path: string;
    }[]>(`
      SELECT 
        dc.class_name,
        a.uuid as aip_uuid,
        d.root_path as document_root_path,
        f.relative_path as file_relative_path
      FROM document_class dc
      LEFT JOIN aip a ON dc.id = a.document_class_id
      LEFT JOIN document d ON a.uuid = d.aip_uuid
      LEFT JOIN file f ON d.id = f.document_id
      ORDER BY dc.class_name, a.uuid, d.root_path, f.relative_path
    `);
    console.log(rows);

    return this.buildHierarchicalTree(rows);
  }

  async getPhysicalPathFromDb(logicalPath: string): Promise<string | undefined> {
    // Nel nuovo sistema, il percorso fisico è costruito dal file system handle
    // Per ora restituiamo il percorso relativo stesso
    const rows = await this.executeQuery<{ relative_path: string }[]>(
      'SELECT relative_path FROM file WHERE relative_path = ?',
      [logicalPath]
    );

    return rows.length > 0 ? rows[0].relative_path : undefined;
  }

  async saveIntegrityStatus(logicalPath: string, isValid: boolean, calculatedHash: string, expectedHash: string): Promise<void> {
    // TODO: Implementare tabella file_integrity nello schema
    console.warn('[DatabaseService] saveIntegrityStatus non ancora implementato nel nuovo schema');
  }

  async getIntegrityStatus(logicalPath: string): Promise<{ isValid: boolean, calculatedHash: string, expectedHash: string, verifiedAt: string } | null> {
    // TODO: Implementare tabella file_integrity nello schema
    return null;
  }

  /**
   * Recupera gli attributi metadati indicizzati per una visualizzazione pulita (Key-Value).
   */
  async getMetadataAttributes(logicalPath: string): Promise<{ key: string; value: string }[]> {
    // Verifica se il file è principale o allegato
    const fileInfo = await this.executeQuery<{ is_main: number }[]>(
      'SELECT is_main FROM file WHERE relative_path = ?',
      [logicalPath]
    );
    
    if (fileInfo.length === 0) {
      console.warn(`[DatabaseService] File non trovato per getMetadataAttributes: ${logicalPath}`);
      return [];
    }
    
    const isMain = fileInfo[0].is_main;
    let rows;
    
    if (!isMain) {
      // Allegato: usa file_id
      rows = await this.executeQuery<{ meta_key: string; meta_value: string }[]>(
        'SELECT meta_key, meta_value FROM metadata WHERE file_id = (SELECT id FROM file WHERE relative_path = ?) ORDER BY meta_key',
        [logicalPath]
      );
    } else {
      // File principale: usa document_id
      rows = await this.executeQuery<{ meta_key: string; meta_value: string }[]>(
        'SELECT meta_key, meta_value FROM metadata WHERE document_id IN (SELECT document_id FROM file WHERE relative_path = ?) ORDER BY meta_key',
        [logicalPath]
      );
    }

    return rows.map(r => ({ key: r.meta_key, value: r.meta_value }));
  }

  /**
   * Recupera tutte le chiavi univoche presenti nei metadati per popolare i filtri.
   */
  async getAvailableMetadataKeys(): Promise<string[]> {
    const rows = await this.executeQuery<{ meta_key: string }[]>(
      'SELECT DISTINCT meta_key FROM metadata ORDER BY meta_key'
    );

    return rows.map(r => r.meta_key);
  }

  /**
   * Ottiene i filtri organizzati in gruppi per la visualizzazione optgroup.
   */
  async getGroupedFilterKeys(): Promise<
    {
      groupLabel: string;
      groupPath: string;
      options: Array<{ value: string; label: string }>;
    }[]
  > {
    const keys = await this.getAvailableMetadataKeys();
    return FilterManager.groupKeysForSelect(keys);
  }

  /**
   * Ottiene la mappa di consolidamento per i filtri.
   */
  async getFilterConsolidationMap(): Promise<Map<string, string[]>> {
    const keys = await this.getAvailableMetadataKeys();
    return FilterManager.buildFilterConsolidationMap(keys);
  }

  /**
   * Cerca documenti combinando ricerca per nome e filtri sui metadati.
   * Mantiene la gerarchia DocumentClass -> AiP -> Document -> File
   */
  async searchDocuments(nameQuery: string, filters: Filter[]): Promise<FileNode[]> {
    let sql_mains = `
      SELECT 
        dc.class_name,
        a.uuid as aip_uuid,
        d.root_path as document_root_path,
        f.relative_path as file_relative_path
      FROM file f
      INNER JOIN document d ON f.document_id = d.id
      INNER JOIN aip a ON d.aip_uuid = a.uuid
      INNER JOIN document_class dc ON a.document_class_id = dc.id
    `;
    let sql_attachments = `SELECT 
        dc.class_name,
        a.uuid as aip_uuid,
        d.root_path as document_root_path,
        f.relative_path as file_relative_path
      FROM file f
      INNER JOIN document d ON f.document_id = d.id
      INNER JOIN aip a ON d.aip_uuid = a.uuid
      INNER JOIN document_class dc ON a.document_class_id = dc.id
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    // Filtro per nome file
    if (nameQuery && nameQuery.trim() !== '') {
      conditions.push('f.relative_path LIKE ?');
      params.push(`%${nameQuery.trim()}%`);
    }

    // Filtri sui metadati
    if (filters.length > 0) {
      filters.forEach((filter, index) => {
        if (filter.key && filter.value) {
          sql_mains += ` INNER JOIN metadata m${index} ON f.document_id = m${index}.document_id WHERE f.is_main = 1 AND `;
          sql_attachments += ` INNER JOIN metadata m${index} ON f.id = m${index}.file_id WHERE f.is_main = 0 AND `;
          conditions.push(`m${index}.meta_key = ? AND m${index}.meta_value LIKE ?`);
          params.push(filter.key, `%${filter.value}%`);
        }
      });
    }

    if (conditions.length > 0) {
      sql_mains += conditions.join(' AND ');
      sql_attachments += conditions.join(' AND ');
    }

    sql_mains += ' ORDER BY dc.class_name, a.uuid, d.root_path, f.relative_path';
    sql_attachments += ' ORDER BY dc.class_name, a.uuid, d.root_path, f.relative_path';

    console.log('query:', sql_mains, 'params:', params);

    let rows = await this.executeQuery<{
      class_name: string;
      aip_uuid: string;
      document_root_path: string;
      file_relative_path: string;
    }[]>(sql_mains, params);

    const attachmentRows = await this.executeQuery<{
      class_name: string;
      aip_uuid: string;
      document_root_path: string;
      file_relative_path: string;
    }[]>(sql_attachments, params);

    rows = rows.concat(attachmentRows);

    console.log('[DatabaseService] Risultati trovati:', rows.length);

    // Usa la stessa funzione per costruire la gerarchia, ma espandi tutto per i risultati di ricerca
    return this.buildHierarchicalTree(rows, true);
  }

  /**
   * Scarica il database corrente come file .sqlite3 sul computer dell'utente.
   */
  exportDatabase(): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'EXPORT_DB' });
  }

  /**
   * Costruisce un albero gerarchico basato sulla struttura reale del database:
   * DocumentClass -> AiP -> Document -> File
   */
  private buildHierarchicalTree(rows: Array<{
    class_name: string;
    aip_uuid: string;
    document_root_path: string;
    file_relative_path: string;
  }>, expandAll = false): FileNode[] {
    const root: FileNode[] = [];
    const classMap = new Map<string, FileNode>();
    const aipMap = new Map<string, FileNode>();
    const documentMap = new Map<string, FileNode>();

    rows.forEach(row => {
      // 1. Livello DocumentClass
      let classNode = classMap.get(row.class_name);
      if (!classNode) {
        classNode = {
          name: row.class_name || 'Classe Documentale',
          path: `class:${row.class_name}`,
          type: 'folder',
          children: [],
          expanded: expandAll
        };
        classMap.set(row.class_name, classNode);
        root.push(classNode);
      }

      // 2. Livello AiP (Archival Information Package)
      const aipKey = `${row.class_name}::${row.aip_uuid}`;
      let aipNode = aipMap.get(aipKey);
      if (!aipNode && row.aip_uuid) {
        // Usa un nome più leggibile per l'AiP (primi 8 caratteri UUID)
        const aipDisplayName = `AiP ${row.aip_uuid.substring(0, 8)}`;
        aipNode = {
          name: aipDisplayName,
          path: `aip:${row.aip_uuid}`,
          type: 'folder',
          children: [],
          expanded: expandAll
        };
        aipMap.set(aipKey, aipNode);
        classNode.children.push(aipNode);
      }

      // 3. Livello Document
      const docKey = `${aipKey}::${row.document_root_path}`;
      let documentNode = documentMap.get(docKey);
      if (!documentNode && row.document_root_path && aipNode) {
        // Estrae il nome del documento dal path
        const docName = row.document_root_path.split('/').pop() || row.document_root_path;
        documentNode = {
          name: docName,
          path: `doc:${row.document_root_path}`,
          type: 'folder',
          children: [],
          expanded: expandAll
        };
        documentMap.set(docKey, documentNode);
        aipNode.children.push(documentNode);
      }

      // 4. Livello File (foglia)
      if (row.file_relative_path && documentNode) {
        const fileName = row.file_relative_path.split('/').pop() || row.file_relative_path;
        const fileNode: FileNode = {
          name: fileName,
          path: row.file_relative_path, // Usa il percorso relativo completo come ID
          type: 'file',
          children: []
        };
        documentNode.children.push(fileNode);
      }
    });

    return root;
  }

  /**
   * Cerca ricorsivamente un valore in un oggetto tramite la sua chiave.
   */
  public findValueByKey(obj: any, key: string): string | null {
    if (!obj || typeof obj !== 'object') {
      return null;
    }

    if (key in obj) {
      const value = obj[key];
      if (typeof value === 'object' && value !== null && '#text' in value) {
        return value['#text'];
      }
      if (typeof value === 'string') {
        return value;
      }
    }

    for (const k in obj) {
      if (obj.hasOwnProperty(k)) {
        const found = this.findValueByKey(obj[k], key);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  /**
   * Ricerca file per nome
   */
  async searchNodesByName(nameQuery: string): Promise<string[]> {
    if (!nameQuery.trim()) return [];

    const rows = await this.executeQuery<{ relative_path: string }[]>(
      'SELECT DISTINCT relative_path FROM file WHERE relative_path LIKE ? AND is_main = 1',
      [`%${nameQuery}%`]
    );

    return rows.map(r => r.relative_path);
  }

  /**
   * Alias per getAvailableMetadataKeys()
   */
  async getAllMetadataKeys(): Promise<string[]> {
    return await this.getAvailableMetadataKeys();
  }

  /**
   * Alias per getGroupedFilterKeys()
   */
  async getGroupedMetadataKeys(): Promise<
    Array<{
      groupLabel: string;
      groupPath: string;
      options: Array<{ value: string; label: string }>;
    }>
  > {
    return await this.getGroupedFilterKeys();
  }
}
