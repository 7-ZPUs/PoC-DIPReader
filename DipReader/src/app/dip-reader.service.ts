import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { XMLParser } from 'fast-xml-parser';
import { map, switchMap, catchError } from 'rxjs/operators';
import { Observable, forkJoin, of } from 'rxjs';

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

  private metadataMap: { [logicalPath: string]: any } = {};
  private physicalPathMap: { [logicalPath: string]: string } = {};
  
  constructor(private http: HttpClient) {}

  /**
   * Orchestratore principale. Carica dinamicamente l'intero pacchetto DIP.
   * 1. Legge DiPIndex.xml per capire la struttura.
   * 2. Carica in parallelo tutti i file .metadata.xml necessari usando i percorsi fisici corretti.
   * 3. Costruisce in memoria sia l'albero dei file che le mappe per i metadati e i percorsi fisici.
   * @returns Un Observable che emette l'albero dei file (FileNode[]) una volta completato tutto il processo.
   */
  public loadPackage(): Observable<FileNode[]> {
    // IL NOME ESATTO DEL TUO FILE
    const fileName = 'DiPIndex.20251111.0413d8ee-8e82-4331-864e-7f8098bcc419.xml';
    const basePath = fileName.includes('/') ? fileName.substring(0, fileName.lastIndexOf('/') + 1) : '';

    // --- FASE 1: Carica il file indice ---
    return this.http.get(fileName, { responseType: 'text' }).pipe(
      // --- FASE 2: Analizza l'indice e pianifica il caricamento dei metadati ---
      switchMap(indexXmlStr => {
        const indexJson = this.parseXml(indexXmlStr);
        const { logicalPaths, loadPlan } = this.analyzeIndex(indexJson);

        // Popola subito la mappa dei percorsi fisici
        loadPlan.forEach(plan => {
          this.physicalPathMap[plan.logicalPath] = basePath + plan.physicalDocPath;
        });

        if (loadPlan.length === 0) {
          console.warn("Nessun file di metadati da caricare.");
          this.metadataMap = {};
          const tree = this.buildTree(logicalPaths);
          return of(tree); // Restituisce l'albero direttamente se non ci sono metadati
        }

        // --- FASE 3: Esegue il caricamento in parallelo dei metadati ---
        const metadataRequests = loadPlan.map(plan =>
          this.http.get(basePath + plan.physicalMetaPath, { responseType: 'text' }).pipe(
            map(metaXmlStr => ({
              logicalPath: plan.logicalPath,
              metadata: this.parseXml(metaXmlStr)
            })),
            // Gestisce con grazia un 404 per un singolo file di metadati
            catchError(err => {
              console.warn(`Impossibile caricare i metadati da '${basePath + plan.physicalMetaPath}':`, err);
              return of({ logicalPath: plan.logicalPath, metadata: { error: `File di metadati non trovato.` } });
            })
          )
        );

        // --- FASE 4: Consolida i dati e restituisce il risultato finale ---
        return forkJoin(metadataRequests).pipe(
          map(results => {
            // Costruisce la mappa dei metadati
            const newMetadataMap: { [key: string]: any } = {};
            results.forEach(result => {
              newMetadataMap[result.logicalPath] = result.metadata;
            });
            this.metadataMap = newMetadataMap;
            console.log("Mappa dei metadati costruita dinamicamente:", this.metadataMap);

            // Costruisce l'albero e lo restituisce al componente
            const tree = this.buildTree(logicalPaths);
            return tree;
          })
        );
      })
    );
  }

  /**
   * Recupera i metadati per un file dalla mappa pre-caricata in memoria.
   * @param logicalPath Il percorso logico del file, usato come chiave.
   * @returns L'oggetto dei metadati.
   */
  public getMetadataForFile(logicalPath: string): any {
    return this.metadataMap[logicalPath] || { error: 'Metadati non trovati nella mappa pre-caricata.' };
  }

  /**
   * Recupera il percorso fisico web-accessible per un file.
   * @param logicalPath Il percorso logico del file, usato come chiave.
   * @returns Il percorso fisico completo (es. 'mio_dip/documenti/file.pdf').
   */
  public getPhysicalPathForFile(logicalPath: string): string | undefined {
    return this.physicalPathMap[logicalPath];
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

  private buildTree(logicalPaths: string[]): FileNode[] {
    const root: FileNode[] = [];
    logicalPaths.forEach(logicalPath => {
      const parts = logicalPath.split('/');
      let currentLevel = root;

      parts.forEach((part, index) => {
        const isFile = index === parts.length - 1;
        let existingNode = currentLevel.find(n => n.name === part);

        if (!existingNode) {
          const newNode: FileNode = {
            name: part,
            // Il path del nodo è il percorso logico completo, usato come chiave
            path: isFile ? logicalPath : '', 
            type: isFile ? 'file' : 'folder',
            children: [],
            expanded: false
          };
          currentLevel.push(newNode);
          existingNode = newNode;
        }

        if (!isFile) {
          currentLevel = existingNode.children;
        }
      });
    });
    return root;
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

}