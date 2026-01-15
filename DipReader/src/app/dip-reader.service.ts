import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { XMLParser } from 'fast-xml-parser';
import { map, catchError } from 'rxjs/operators';
import { Observable, forkJoin, of, from, lastValueFrom } from 'rxjs';
import { DatabaseService } from './database.service';
import { Filter } from './filter-manager';

export interface FileNode {
  name: string;
  path: string; // Questo sarà il "percorso logico", usato come chiave unica
  type: 'folder' | 'file';
  children: FileNode[];
  expanded?: boolean; // Per aprire/chiudere le cartelle
}

@Injectable({ providedIn: 'root' })
export class DipReaderService {
  private parser = new XMLParser({ 
    ignoreAttributes: false, 
    attributeNamePrefix: '@_'
  });

  constructor(private http: HttpClient, private dbService: DatabaseService) {}

  /**
   * Orchestratore principale. Carica dinamicamente l'intero pacchetto DIP.
   * Verifica se il DB è popolato; se no, esegue l'importazione dai file XML.
   * @returns Un Observable che emette l'albero dei file (FileNode[]) una volta completato tutto il processo.
   */
  public loadPackage(): Observable<FileNode[]> {
    return from(this.loadPackageAsync());
  }

  private async loadPackageAsync(): Promise<FileNode[]> {
    await this.dbService.initializeDb();

    const manifestPath = 'package-manifest.json';
    let manifest: { indexFile: string } | undefined;

    try {
      manifest = await lastValueFrom(this.http.get<{ indexFile: string }>(manifestPath));
    } catch (err) {
      console.error(`ERRORE CRITICO: Impossibile caricare il file manifest da '${manifestPath}'.`, err);
      return [];
    }

    if (!manifest || !manifest.indexFile) {
      console.error("Manifest non valido o 'indexFile' mancante.");
      return [];
    }

    const fileName = manifest.indexFile;

    // Controlla se il DB è già popolato per questa versione
    const isPopulated = await this.dbService.isPopulated(fileName);
    if (isPopulated) {
      console.log('Database già popolato. Caricamento veloce da SQLite...');
      return this.dbService.getTreeFromDb();
    }

    console.log('Database non aggiornato. Avvio importazione da XML...');
    return this.importFromXml(fileName);
  }

  private async importFromXml(fileName: string): Promise<FileNode[]> {
    const basePath = fileName.includes('/') ? fileName.substring(0, fileName.lastIndexOf('/') + 1) : '';
    const indexXmlStr = await lastValueFrom(this.http.get(fileName, { responseType: 'text' }));

    const indexJson = this.parseXml(indexXmlStr);
    const { logicalPaths, loadPlan } = this.analyzeIndex(indexJson);

    const physicalPathMap: { [key: string]: string } = {};
    loadPlan.forEach(plan => {
      physicalPathMap[plan.logicalPath] = this.encodePath(basePath + plan.physicalDocPath);
    });

    let metadataMap: { [key: string]: any } = {};

    if (loadPlan.length > 0) {
      const metadataRequests = loadPlan.map(plan =>
        this.http.get(basePath + plan.physicalMetaPath, { responseType: 'text' }).pipe(
          map(metaXmlStr => ({ logicalPath: plan.logicalPath, metadata: this.parseXml(metaXmlStr) })),
          catchError(err => {
            console.warn(`Impossibile caricare i metadati da '${basePath + plan.physicalMetaPath}':`, err);
            return of({ logicalPath: plan.logicalPath, metadata: { error: `File di metadati non trovato.` } });
          })
        )
      );

      const results = await lastValueFrom(forkJoin(metadataRequests));
      metadataMap = Object.fromEntries(results.map(r => [r.logicalPath, r.metadata]));

      // Aggiorna i percorsi fisici se il nome del file reale è presente nei metadati
      results.forEach(r => {
        if (r.metadata && !r.metadata.error) {
          // Cerca chiavi comuni per il nome del file nei metadati
          let realFileName = this.dbService.findValueByKey(r.metadata, '@_originalFileName') ||
                             this.dbService.findValueByKey(r.metadata, 'NomeFile') || 
                             this.dbService.findValueByKey(r.metadata, 'File') ||
                             this.dbService.findValueByKey(r.metadata, 'NomeOriginale');

          // Fallback: usa NomeDelDocumento se sembra un file (ha un'estensione)
          if (!realFileName) {
            const docName = this.dbService.findValueByKey(r.metadata, 'NomeDelDocumento');
            if (docName && /\.[a-zA-Z0-9]{3,4}$/.test(docName)) {
              realFileName = docName;
            }
          }

          if (realFileName) {
            const plan = loadPlan.find(p => p.logicalPath === r.logicalPath);
            if (plan) {
              // Costruisce il percorso usando la cartella del file metadata + il nome file reale
              const metaDir = plan.physicalMetaPath.substring(0, plan.physicalMetaPath.lastIndexOf('/'));
              const fullPath = basePath + (metaDir ? metaDir + '/' : '') + realFileName.trim();
              physicalPathMap[r.logicalPath] = this.encodePath(fullPath);
            }
          }
        }
      });
    }

    // Popola il database e restituisce l'albero
    await this.dbService.populateDatabase(fileName, logicalPaths, metadataMap, physicalPathMap);
    return this.dbService.getTreeFromDb();
  }

  /**
   * Recupera i metadati per un file dal database.
   */
  public async getMetadataForFile(logicalPath: string): Promise<any> {
    return this.dbService.getMetadataFromDb(logicalPath);
  }

  /**
   * Recupera il percorso fisico web-accessible per un file dal database.
   */
  public async getPhysicalPathForFile(logicalPath: string): Promise<string | undefined> {
    return this.dbService.getPhysicalPathFromDb(logicalPath);
  }

  /**
   * Ottiene la lista delle chiavi di metadati disponibili per il filtraggio.
   */
  public async getAvailableMetadataKeys(): Promise<string[]> {
    return this.dbService.getAvailableMetadataKeys();
  }

  /**
   * Ottiene i filtri organizzati in gruppi per optgroup.
   */
  public async getGroupedFilterKeys(): Promise<
    {
      groupLabel: string;
      groupPath: string;
      options: Array<{ value: string; label: string }>;
    }[]
  > {
    return this.dbService.getGroupedFilterKeys();
  }

  /**
   * Esegue una ricerca complessa con filtri globali.
   */
  public async searchDocuments(nameQuery: string, filters: Filter[]): Promise<FileNode[]> {
    return this.dbService.searchDocuments(nameQuery, filters);
  }

  public downloadDebugDb(): void {
    this.dbService.exportDatabase();
  }

  /**
   * Verifica l'integrità del file calcolando l'hash SHA-256 e confrontandolo con i metadati.
   */
  public async verifyFileIntegrity(logicalPath: string): Promise<{ valid: boolean, calculated: string, expected: string }> {
    const physicalPath = await this.getPhysicalPathForFile(logicalPath);
    if (!physicalPath) throw new Error('File fisico non trovato.');

    const metadata = await this.getMetadataForFile(logicalPath);
    // Cerca l'hash nei metadati. La chiave specifica è "Impronta".
    // Il path completo è solitamente: Document.DocumentoAmministrativoInformatico.IdDoc.ImprontaCrittograficaDelDocumento.Impronta
    const expectedHash = this.dbService.findValueByKey(metadata, 'Impronta');

    if (!expectedHash) {
      throw new Error('Impronta crittografica (Hash) non trovata nei metadati.');
    }

    // Scarica il file come blob/buffer per calcolare l'hash
    const response = await fetch(physicalPath);
    if (!response.ok) {
      throw new Error(`Impossibile leggere il file per la verifica: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();

    // Calcola SHA-256 usando le API native del browser (SubtleCrypto)
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const calculatedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return {
      valid: calculatedHash.toLowerCase() === expectedHash.toLowerCase(),
      calculated: calculatedHash,
      expected: expectedHash
    };
  }

  // --- HELPERS PRIVATI ---

  private analyzeIndex(indexJson: any): { logicalPaths: string[], loadPlan: { logicalPath: string, physicalDocPath: string, physicalMetaPath: string }[] } {
    const logicalPaths: string[] = [];
    const loadPlan: { logicalPath: string, physicalDocPath: string, physicalMetaPath: string }[] = [];

    const root = indexJson.DiPIndex || indexJson;
    const content = root.PackageContent;
    const dipDocs = content?.DiPDocuments || content;

    const asArray = (x: any) => Array.isArray(x) ? x : (x ? [x] : []);

    const classes = asArray(dipDocs.DocumentClass || dipDocs);
    classes.forEach((docClass: any) => {
        const className = docClass['@_name'] || 'ClasseDocumentale';
        const aips = asArray(docClass.AiP);
        aips.forEach((aip: any) => {
            const aipName = aip['@_name'] || 'PacchettoArchivistico';
            // ASSUNZIONE CRITICA: Il percorso intermedio (es. '2025/11/...') si trova in una proprietà dell'elemento AiP.
            // Sto assumendo che si chiami 'AiPPath'. Se non funziona, dovrai controllare il file JSON
            // esportato in passato per trovare il nome corretto di questa proprietà.
            const aipPathSegment = (this.getText(aip.AiPRoot) || '').replace(/^\./, '');

            const documents = asArray(aip.Document);
            documents.forEach((doc: any) => {
                const physicalDocPathRaw = this.getText(doc.DocumentPath);
                if (physicalDocPathRaw) {
                    const documentPathSegment = this.cleanPath(physicalDocPathRaw);
                    const fileName = documentPathSegment.split('/').pop() || documentPathSegment;

                    const logicalPath = `${className}/${aipName}/${fileName}`;
                    logicalPaths.push(logicalPath);

                    // Costruzione esplicita del percorso per garantire la corretta unione.
                    // Si rimuovono eventuali slash iniziali/finali per evitare duplicati.
                    const cleanAipPath = aipPathSegment.replace(/\/$/, '');
                    const cleanDocPath = documentPathSegment.replace(/^\//, '');
                    const physicalDocPath = [cleanAipPath, cleanDocPath].filter(p => p).join('/');
                    const physicalMetaPath = this.getMetaPathFromDocPath(physicalDocPath);

                    loadPlan.push({ logicalPath, physicalDocPath, physicalMetaPath });
                }
            });
        });
    });

    logicalPaths.sort();
    return { logicalPaths, loadPlan };
  }

  private parseXml(xmlStr: string): any {
    const cleanXml = xmlStr.replace(/<([a-zA-Z0-9]+):/g, '<').replace(/<\/([a-zA-Z0-9]+):/g, '</');
    return this.parser.parse(cleanXml);
  }

  private cleanPath(path: string): string {
    let clean = path.startsWith('./') ? path.substring(2) : path;
    clean = clean.replace(/\\/g, '/');
    return clean;
  }

  private getMetaPathFromDocPath(docPath: string): string {
    // Trova il percorso della cartella e il nome completo del file
    const lastSlashIndex = docPath.lastIndexOf('/');
    const dirPath = (lastSlashIndex > -1) ? docPath.substring(0, lastSlashIndex) : '';
    const fullFileName = (lastSlashIndex > -1) ? docPath.substring(lastSlashIndex + 1) : docPath;

    // Trova il nome base del file (senza estensione)
    const lastDotIndex = fullFileName.lastIndexOf('.');
    const baseFileName = (lastDotIndex > -1) ? fullFileName.substring(0, lastDotIndex) : fullFileName;

    // Costruisce il percorso finale secondo la struttura: {dir}/{basename}/{basename}.metadata.xml
    // L'uso di filter(p => p) previene la creazione di doppi slash se una parte è vuota.
    return [dirPath, baseFileName, `${baseFileName}.metadata.xml`].filter(p => p).join('/');
  }

  private getText(obj: any): string | null {
    if (!obj) return null;
    if (typeof obj === 'string') return obj;
    if (obj['#text']) return obj['#text'];
    return null;
  }

  /**
   * Codifica i segmenti del percorso per renderli validi negli URL (gestione spazi, accenti, ecc.)
   * Mantiene i separatori '/' intatti.
   */
  private encodePath(path: string): string {
    return path.split('/').map(p => encodeURIComponent(p)).join('/');
  }
}