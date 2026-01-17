import { Injectable } from '@angular/core';
import { IDipIndexService } from './search-engine.interface';
import { FileNode } from './dip-reader.service';
import { BenchmarkService } from './benchmark.service';

// Simuliamo i tipi per il modulo WASM di Tantivy
// In un caso reale, questi verrebbero dal pacchetto wasm-pack generato
interface TantivyModule {
  Index: any;
  SchemaBuilder: any;
  QueryParser: any;
}

@Injectable({ providedIn: 'root' })
export class TantivyService implements IDipIndexService {
  private index: any = null;
  private searcher: any = null;
  private schema: any = null;
  
  // Store in memoria per le funzionalità NON di ricerca (Albero e Percorsi)
  private memoryTree: FileNode[] = [];
  private memoryPhysicalPaths = new Map<string, string>();
  private memoryMetadata = new Map<string, any>();
  private memoryConfig = new Map<string, string>();

  constructor(private bench: BenchmarkService) {}

  async initializeDb(): Promise<void> {
    console.log('Inizializzazione Tantivy WASM...');
    
    // Simile al caricamento dinamico che fai per SQLite
    // @ts-ignore
    const wasmUrl = '/tantivy_binding_bg.wasm'; 
    // @ts-ignore
    const pkg = await import(/* @vite-ignore */ '/tantivy_binding.js');
    await pkg.default(wasmUrl); // Inizializza WASM memory

    const { SchemaBuilder, Index } = pkg;

    // 1. Definiamo lo Schema
    const builder = new SchemaBuilder();
    builder.add_text_field("logical_path", { stored: true }); // ID univoco
    builder.add_text_field("name", { stored: true });         // Per ricerca nome
    builder.add_text_field("all_metadata", { stored: false }); // Blob per ricerca full-text
    // Aggiungiamo campi specifici per filtri sfaccettati se necessario
    // builder.add_text_field("author", { stored: true }); 

    this.schema = builder.build();
    
    // Creiamo un indice in memoria RAM
    this.index = new Index(this.schema);
    console.log('Indice Tantivy pronto in memoria.');
  }

  async isPopulated(indexFileName: string): Promise<boolean> {
    // In questa implementazione in RAM, se ricarichi la pagina perdi i dati.
    // Per il test va bene ritornare sempre false o controllare la variabile memoryConfig
    return this.memoryConfig.get('dip_index_version') === indexFileName;
  }

  async populateDatabase(
    indexFileName: string,
    logicalPaths: string[],
    metadataMap: { [key: string]: any },
    physicalPathMap: { [key: string]: string }
  ): Promise<void> {
    
    const writer = this.index.writer();
    
    // 1. Costruzione Albero e Store in Memoria (sostituisce INSERT INTO nodes/physical)
    this.memoryPhysicalPaths = new Map(Object.entries(physicalPathMap));
    this.memoryMetadata = new Map(Object.entries(metadataMap));
    this.memoryTree = this.buildTreeInMemory(logicalPaths, metadataMap);

    // 2. Indicizzazione su Tantivy
    for (const path of logicalPaths) {
      const metadata = metadataMap[path] || {};
      const name = this.findDocName(metadata, path);
      
      // "Appiattiamo" il JSON dei metadati in una stringa unica per la ricerca full-text
      const metaString = JSON.stringify(metadata);

      writer.add_document({
        logical_path: path,
        name: name,
        all_metadata: metaString
      });
    }

    writer.commit();
    this.memoryConfig.set('dip_index_version', indexFileName);
    console.log(`Indicizzati ${logicalPaths.length} documenti in Tantivy.`);
  }

  // --- Implementazione Metodi di Lettura (da Memoria) ---

  async getTreeFromDb(): Promise<FileNode[]> {
    return this.memoryTree;
  }

  async getMetadataForFile(logicalPath: string): Promise<any> {
    return this.memoryMetadata.get(logicalPath) || { error: 'Non trovato' };
  }

  async getPhysicalPathForFile(logicalPath: string): Promise<string | undefined> {
    return this.memoryPhysicalPaths.get(logicalPath);
  }

  async getAvailableMetadataKeys(): Promise<string[]> {
    // Implementazione semplificata: estrai chiavi dal primo oggetto in memoria
    // Tantivy non è ottimizzato per "SELECT DISTINCT keys", meglio farlo in JS durante il populate
    return ["Note: Tantivy mode has limited facet support in this test"];
  }

  public findValueByKey(obj: any, key: string): string | null {
    if (!obj || typeof obj !== 'object') {
      return null;
    }

    // Caso base: la chiave è una proprietà diretta dell'oggetto
    if (key in obj) {
      const value = obj[key];
      // Il parser XML potrebbe creare un oggetto { '#text': 'valore' }
      if (typeof value === 'object' && value !== null && '#text' in value) {
        return value['#text'];
      }
      if (typeof value === 'string') {
        return value;
      }
    }

    // Passo ricorsivo: cerca nelle proprietà dell'oggetto
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        const found = this.findValueByKey(obj[k], key);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  // --- Implementazione Metodo di Ricerca (CORE TANTIVY) ---

  async searchDocuments(nameQuery: string, filters: { key: string, value: string }[]): Promise<FileNode[]> {
    // 1. Costruzione Query String stile Lucene
    // Esempio: "name:fattura AND all_metadata:2023"
    let parts = [];

    const stopTimer = this.bench.startTimer('Tantivy', 'searchDocuments');
    
    if (nameQuery) {
      parts.push(`name:"${nameQuery}"`);
    }

    // Nota: Per cercare chiavi specifiche nei filtri con Tantivy, dovremmo averle indicizzate come campi separati nello schema.
    // Per questo test veloce, cerchiamo il valore nel "blob" dei metadati.
    for (const filter of filters) {
      if (filter.value) {
        parts.push(`all_metadata:"${filter.value}"`);
      }
    }

    const queryString = parts.join(" AND ") || "*";
    console.log(`[Tantivy] Query: ${queryString}`);

    const searcher = this.index.searcher();
    const queryParser = this.index.query_parser_for_index(["name", "all_metadata"]);
    
    try {
      const query = queryParser.parse_query(queryString);
      const topDocs = searcher.search(query, 50); // Limit 50

      // Mappiamo i risultati Tantivy in nodi parziali per la UI
      const results: any[] = [];
      for (const [score, docAddress] of topDocs) {
        const doc = searcher.doc(docAddress);
        // doc è un oggetto { logical_path: ["..."], name: ["..."] } (array di valori)
        const path = doc.logical_path[0];
        const name = doc.name[0];
        
        results.push({ logical_path: path, name: name });
      }
      stopTimer(`Query: "${nameQuery}"`);
      return this.buildTreeFromResults(results);

    } catch (e) {
      console.error("Tantivy query error:", e);
      return [];
    }
  }

  // --- Helpers (Duplicati o adattati da DatabaseService) ---
  
  private findDocName(metadata: any, path: string): string {
    // ... Logica di estrazione nome (copia da DatabaseService o crea una utility condivisa) ...
    return path.split('/').pop() || '';
  }

  private buildTreeInMemory(paths: string[], metaMap: any): FileNode[] {
    // ... Logica identica a buildTree, ma lavora sugli array in ingresso ...
    // Per brevità non la copio, ma dovresti spostare 'buildTree' in una classe Utils condivisa
    return []; 
  }

  private buildTreeFromResults(rows: any[]): FileNode[] {
     // ... Ricostruzione albero parziale ...
     return [];
  }
}