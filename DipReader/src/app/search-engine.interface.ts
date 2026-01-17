import { FileNode } from './dip-reader.service';
import { InjectionToken } from '@angular/core';

export const SEARCH_ENGINE = new InjectionToken<IDipIndexService>('SearchEngine');

export interface IDipIndexService {
  initializeDb(): Promise<void>;
  
  isPopulated(indexFileName: string): Promise<boolean>;
  
  populateDatabase(
    indexFileName: string,
    logicalPaths: string[],
    metadataMap: { [key: string]: any },
    physicalPathMap: { [key: string]: string }
  ): Promise<void>;

  // Per la visualizzazione dell'albero
  getTreeFromDb(): Promise<FileNode[]>;
  
  // Per il recupero dettagli
  getMetadataForFile(logicalPath: string): Promise<any>;
  getPhysicalPathForFile(logicalPath: string): Promise<string | undefined>;
  
  // Per la ricerca e filtri
  getAvailableMetadataKeys(): Promise<string[]>;
  searchDocuments(nameQuery: string, filters: { key: string, value: string }[]): Promise<FileNode[]>;
  exportDatabase?(): void; 

  // AGGIUNTA NECESSARIA: DipReaderService usa questo helper
  findValueByKey(obj: any, key: string): string | null;
}