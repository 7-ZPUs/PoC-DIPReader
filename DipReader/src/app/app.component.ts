import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService, FileNode } from './database-electron.service';
import { MetadataViewerComponent } from './metadata-viewer.component';
import { Filter } from './filter-manager';

import { SearchService } from './services/search.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MetadataViewerComponent, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {
  // Albero dei file e selezione
  fileTree: FileNode[] = [];
  selectedFile: FileNode | null = null;
  metadata: any = null;

  // Proprietà per la ricerca
  searchName = '';
  availableKeys: string[] = [];
  groupedFilterKeys: Array<{
    groupLabel: string;
    groupPath: string;
    options: Array<{ value: string; label: string }>;
  }> = [];
  filters: Filter[] = [];
  isSearching = false;
  searchExecutionTime: number | null = null;
  
  // Stato verifica integrità
  integrityStatus: 'none' | 'loading' | 'valid' | 'invalid' | 'error' = 'none';
  integrityVerifiedAt: string | null = null;

  semanticQuery: string = '';
  generatedVector: number[] | null = null;
  semanticResults: any[] = [];
  isCalculatingVector = false;

  constructor(
    private cdr: ChangeDetectorRef,
    private dbService: DatabaseService,
    private searchService: SearchService
  ) { 
    console.log('App avviata. Attendo 5 secondi prima di indicizzare per l\'AI...');
    
    setTimeout(() => {
      this.searchService.reindexAll().then(() => {
        console.log('Test indicizzazione completato. Ora puoi rimuovere questo blocco.');
      });
    }, 5000); 
  }
  ngOnInit() {
    //
  }

  async loadSearchKeys() {
    if (!this.dbService.isDbReady()) {
      console.warn('[AppComponent] Database non ancora pronto, impossibile caricare i filtri');
      return;
    }

    this.availableKeys = await this.dbService.getAvailableMetadataKeys();
    this.groupedFilterKeys = await this.dbService.getGroupedFilterKeys();
    console.log('Filtri raggruppati caricati:', this.groupedFilterKeys.length, 'gruppi');
  }

  addFilter() {
    this.filters.push({ key: '', value: '' });
  }

  removeFilter(index: number) {
    this.filters.splice(index, 1);
  }

  async performSearch() {
    if (!this.dbService.isDbReady()) {
      alert('Database non ancora pronto. Importare prima una directory.');
      return;
    }

    this.isSearching = true;
    // Pulisce la selezione corrente
    this.selectedFile = null;
    this.metadata = null;

    // Avvia il timer
    const startTime = performance.now();

    this.fileTree = await this.dbService.searchDocuments(this.searchName, this.filters);

    // Calcola il tempo di esecuzione
    const endTime = performance.now();
    this.searchExecutionTime = endTime - startTime;

    console.log(`Ricerca completata in ${this.searchExecutionTime.toFixed(2)} ms`);
    this.cdr.detectChanges();
  }

  clearSearch() {
    this.searchName = '';
    this.filters = [];
    this.fileTree = [];
    this.isSearching = false;
    this.searchExecutionTime = null;
  }

  async handleNodeClick(node: FileNode) {
    if (node.type === 'folder') {
      node.expanded = !node.expanded;
      // Deseleziona il file quando si interagisce con le cartelle
      this.selectedFile = null;
      this.integrityStatus = 'none';
      this.integrityVerifiedAt = null;
      this.metadata = null;
    } else {
      // Imposta il file selezionato così la parte destra si aggiorna
      this.selectedFile = node;
      this.integrityStatus = 'none'; // Resetta lo stato della verifica per il nuovo file
      this.integrityVerifiedAt = null;

      if (!node.fileId) {
        console.error('File ID mancante per il nodo:', node);
        this.metadata = { error: 'File ID non disponibile.' };
        return;
      }

      // Recupera i metadati in modo ASINCRONO dal database usando fileId
      const attributes = await this.dbService.getMetadataAttributes(node.fileId);
      // Converte array in oggetto per retrocompatibilità
      this.metadata = attributes.length > 0
        ? attributes.reduce((acc, attr) => ({ ...acc, [attr.key]: attr.value }), {})
        : { error: 'Metadati non trovati nel DB.' };
      console.log(`Metadati per file ID ${node.fileId}:`, this.metadata);

      // Carica lo stato di integrità salvato, se disponibile
      const storedStatus = await this.dbService.getIntegrityStatus(node.fileId);
      if (storedStatus) {
        this.integrityStatus = storedStatus.isValid ? 'valid' : 'invalid';
        this.integrityVerifiedAt = storedStatus.verifiedAt;
        this.cdr.detectChanges();
      }
    }
  }

  async openFile(node: FileNode) {
    if (!node.fileId) {
      alert('File ID non disponibile.');
      return;
    }

    // Recupera il percorso fisico corretto dal servizio
    const physicalPath = await this.dbService.getPhysicalPathForFile(node.fileId);
    if (physicalPath) {
      console.log(`Apertura percorso fisico: ${physicalPath}`);
      // Apre il file in una nuova scheda
      window.open(physicalPath, '_blank');
    } else {
      console.error(`Impossibile trovare il percorso fisico per il file ID: ${node.fileId}`);
      alert('File non trovato o percorso mancante.');
    }
  }

  async downloadFile(node: FileNode) {
    if (!node.fileId) {
      alert('File ID non disponibile.');
      return;
    }

    const physicalPath = await this.dbService.getPhysicalPathForFile(node.fileId);
    if (physicalPath) {
      const link = document.createElement('a');
      link.href = physicalPath;
      // L'attributo download forza il browser a scaricare il file invece di aprirlo
      link.download = physicalPath.split('/').pop() || node.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      alert('File non trovato o percorso mancante.');
    }
  }

  async checkIntegrity(node: FileNode) {
    if (!node.fileId) {
      alert('File ID non disponibile.');
      return;
    }

    this.integrityStatus = 'loading';
    this.integrityVerifiedAt = null;
    try {
      const result = await this.dbService.verifyFileIntegrity(node.fileId);
      this.integrityStatus = result.valid ? 'valid' : 'invalid';
      this.integrityVerifiedAt = new Date().toISOString();
      this.cdr.detectChanges(); // Forza l'aggiornamento della UI prima dell'alert

      if (!result.valid) {
        console.warn(`Hash mismatch! Atteso: ${result.expected}, Calcolato: ${result.calculated}`);
        setTimeout(() => {
          alert(`Attenzione: Hash non corrispondente!\n\nAtteso:\n${result.expected}\n\nCalcolato:\n${result.calculated}`);
        }, 100);
      }
    } catch (err: any) {
      console.error('Errore verifica integrità:', err);
      this.integrityStatus = 'error';
      this.integrityVerifiedAt = null;
      alert('Errore durante la verifica: ' + err.message);
    }
  }

  downloadDb() {
    this.dbService.exportDatabase();
  }

  async runIndexer() {
    try {
      await this.dbService.indexDirectory();

      this.fileTree = await this.dbService.getTreeFromDb();
      await this.loadSearchKeys();
      this.cdr.detectChanges();

      console.log('Avvio indicizzazione semantica (AI)...');
      
      this.searchService.reindexAll().then(() => {
         console.log('Indicizzazione AI completata con successo.');
         alert('Indicizzazione Completata! Ora puoi usare la ricerca semantica.');
      }).catch(err => {
         console.error('Errore AI:', err);
         alert('Indicizzazione SQL ok, ma errore AI: ' + err.message);
      });
    } catch (error) {
      console.error('Error running indexer:', error);
      alert('Failed to import directory. Please check console for details.');
    }
  }

  formatDate(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getFilesList(fileInfo: any): any[] {
    if (!fileInfo) return [];
    return Array.isArray(fileInfo) ? fileInfo : [fileInfo];
  }

  // app.component.ts

async onTestSemanticSearch() {
  if (!this.semanticQuery.trim()) return;
  
  this.isCalculatingVector = true;
  this.generatedVector = null;
  this.semanticResults = [];

  try {
    // FASE 1: Calcolo Vettore (Costo: ALTO)
    console.log('Calcolo embedding...');
    const vector = await this.searchService.getEmbeddingDebug(this.semanticQuery);
    this.generatedVector = vector;

    // FASE 2: Ricerca usando il vettore (Costo: QUASI ZERO)
    console.log('Esecuzione ricerca per vettore...');
    // Passiamo 'vector' invece di 'this.semanticQuery'
    const rawResults = await this.searchService.searchSemantic(vector);
    
    // ... resto del codice per mappare i risultati ...
    this.semanticResults = await Promise.all(rawResults.map(async (res) => {
        // ... (come prima) ...
         return {
          id: res.id,
          score: (res.score * 100).toFixed(2) + '%',
          name: `Doc #${res.id}` 
        };
    }));

  } catch (e) {
    console.error('Errore semantico:', e);
    alert('Errore durante la ricerca semantica: ' + (e as any).message);
  } finally {
    this.isCalculatingVector = false;
  }
}
}