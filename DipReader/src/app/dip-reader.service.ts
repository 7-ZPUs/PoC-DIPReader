import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { XMLParser } from 'fast-xml-parser';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

export interface FileNode {
  name: string;
  path: string;
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

  constructor(private http: HttpClient) {}

  loadFileSystem(): Observable<FileNode[]> {
    // IL NOME ESATTO DEL TUO FILE
    const fileName = 'DiPIndex.20251111.ec276d29-f80c-4693-b3c9-1cb650e23114.xml';

    return this.http.get(fileName, { responseType: 'text' }).pipe(
      map(xmlStr => {
        // 1. Pulizia namespace (rimuove "ark:", "ns2:", ecc.) per evitare problemi
        const cleanXml = xmlStr.replace(/<([a-zA-Z0-9]+):/g, '<').replace(/<\/([a-zA-Z0-9]+):/g, '</');
        
        // 2. Parsing
        const jsonObj = this.parser.parse(cleanXml);
        
        // 3. Navigazione sicura verso i documenti
        const root = jsonObj.DiPIndex || jsonObj;
        const content = root.PackageContent;
        const dipDocs = content?.DiPDocuments || content;

        // 4. Estrazione elenco percorsi piatti (es: "2023/05/file.pdf")
        const paths = this.extractPaths(dipDocs);
        
        console.log(`Trovati ${paths.length} percorsi file.`); // Debug in console

        // 5. Costruzione Albero
        return this.buildTree(paths);
      })
    );
  }

  // --- LOGICA DI ESTRAZIONE ---
  private extractPaths(dipDocuments: any): string[] {
    let paths: string[] = [];
    if (!dipDocuments) return [];

    // Helper per trasformare qualsiasi cosa (oggetto o null) in array
    const asArray = (x: any) => Array.isArray(x) ? x : (x ? [x] : []);

    const classes = asArray(dipDocuments.DocumentClass || dipDocuments);

    classes.forEach((docClass: any) => {
        const aips = asArray(docClass.AiP);
        aips.forEach((aip: any) => {
            const documents = asArray(aip.Document);
            documents.forEach((doc: any) => {
                // Leggiamo il DocumentPath (es: "./Cartella/File.pdf")
                let rawPath = this.getText(doc.DocumentPath);
                
                if (rawPath) {
                    // Pulizia slash Windows e rimozione "./" iniziale
                    rawPath = rawPath.replace(/\\/g, '/'); 
                    if (rawPath.startsWith('./')) rawPath = rawPath.substring(2);
                    paths.push(rawPath);
                }
            });
        });
    });

    return paths.sort(); // Ordine alfabetico
  }

  // --- LOGICA DI COSTRUZIONE ALBERO ---
  private buildTree(paths: string[]): FileNode[] {
    const root: FileNode[] = [];

    paths.forEach(filePath => {
      // Divide "Cartella/Sub/File.pdf" in ["Cartella", "Sub", "File.pdf"]
      const parts = filePath.split('/');
      let currentLevel = root;

      parts.forEach((part, index) => {
        const isFile = index === parts.length - 1;
        
        // Cerca se esiste già questo nodo al livello corrente
        let existingNode = currentLevel.find(n => n.name === part);

        if (!existingNode) {
          const newNode: FileNode = {
            name: part,
            path: parts.slice(0, index + 1).join('/'),
            type: isFile ? 'file' : 'folder',
            children: [],
            expanded: false // Cartelle chiuse di default
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

  // Helper per leggere il testo anche se ci sono attributi
  private getText(obj: any): string | null {
    if (!obj) return null;
    if (typeof obj === 'string') return obj;
    if (obj['#text']) return obj['#text'];
    return null;
  }
}