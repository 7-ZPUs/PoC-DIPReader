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
    const fileName = 'DiPIndex.20251111.0413d8ee-8e82-4331-864e-7f8098bcc419.xml';

    // 1. Estrae il percorso base dal nome del file (es. "mio-dip/package/")
    const basePath = fileName.includes('/') ? fileName.substring(0, fileName.lastIndexOf('/') + 1) : '';

    return this.http.get(fileName, { responseType: 'text' }).pipe(
      map(xmlStr => {
        // 2. Pulizia namespace (rimuove "ark:", "ns2:", ecc.) per evitare problemi
        const cleanXml = xmlStr.replace(/<([a-zA-Z0-9]+):/g, '<').replace(/<\/([a-zA-Z0-9]+):/g, '</');
        
        // 3. Parsing
        const jsonObj = this.parser.parse(cleanXml);
        
        // ISTRUZIONE DI DEBUG: Esporta il JSON come file per ispezione
        this.exportJsonForDebug(jsonObj, 'parsed-dip-index.json');

        // 4. Navigazione sicura verso i documenti
        const root = jsonObj.DiPIndex || jsonObj;
        const content = root.PackageContent;
        const dipDocs = content?.DiPDocuments || content;

        // 5. Estrazione elenco percorsi relativi (es: "Cartella/file.pdf")
        const relativePaths = this.extractPaths(dipDocs);
        // 6. Crea i percorsi completi, includendo il percorso base del DIP
        const fullPaths = basePath ? relativePaths.map(p => basePath + p) : relativePaths;
        
        console.log(`Trovati ${fullPaths.length} percorsi file.`); // Debug in console

        // 7. Costruzione Albero usando i percorsi completi
        return this.buildTree(fullPaths);
      })
    );
  }

  // --- LOGICA DI ESTRAZIONE ---
  private extractPaths(dipDocuments: any): string[] {
    const paths: string[] = [];
    if (!dipDocuments) return [];

    // Helper per trasformare qualsiasi cosa (oggetto o null) in array
    const asArray = (x: any) => Array.isArray(x) ? x : (x ? [x] : []);

    const classes = asArray(dipDocuments.DocumentClass || dipDocuments);
    classes.forEach((docClass: any) => {
        // 1. Estrae il nome della classe. Questo diventerà una cartella di primo livello.
        //    Si assume che il nome sia in un attributo 'name' (diventa '@_name' nel JSON).
        //    Puoi verificare nel file 'parsed-dip-index.json' che hai esportato.
        const className = docClass['@_name'] || 'ClasseDocumentale';

        const aips = asArray(docClass.AiP);
        aips.forEach((aip: any) => {
            // 2. Estrae il nome dell'AiP. Questo diventerà una sottocartella.
            const aipName = aip['@_name'] || 'PacchettoArchivistico';

            // 3. Costruisce il percorso della cartella basato sulla gerarchia XML.
            const folderPath = `${className}/${aipName}`;

            const documents = asArray(aip.Document);
            documents.forEach((doc: any) => {
                // 4. Legge il percorso originale dal tag <DocumentPath>.
                let rawPath = this.getText(doc.DocumentPath);
                
                if (rawPath) {
                    // 5. Estrae SOLO il nome del file dal percorso originale, ignorando le cartelle.
                    //    Esempio: da "./documents/file.pdf" si ottiene "file.pdf".
                    const fileName = rawPath.split(/[\\/]/).pop() || rawPath;

                    // 6. Combina il percorso delle cartelle gerarchiche con il nome del file.
                    const finalPath = `${folderPath}/${fileName}`;
                    paths.push(finalPath);
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

  /**
   * Helper di debug per scaricare un oggetto JSON come file.
   * @param data L'oggetto da esportare.
   * @param filename Il nome del file da salvare.
   */
  private exportJsonForDebug(data: any, filename: string): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}