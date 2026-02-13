import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatabaseService, FileNode } from './database-electron.service';
import { MetadataViewerComponent } from './metadata-viewer.component';
import { Filter } from './filter-manager';

import { SearchService } from './services/search.service';
import { FileIntegrityService } from './services/file-integrity.service';
import { FileService } from './services/file.service';

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
    private searchService: SearchService,
    private fileIntegrityService: FileIntegrityService,
    private fileService: FileService
  ) { 
    console.log('App avviata. Attendo 5 secondi prima di indicizzare per l\'AI...');
    
    /*setTimeout(() => {
      this.searchService.reindexAll().then(() => {
        console.log('Test indicizzazione completato. Ora puoi rimuovere questo blocco.');
      });
    }, 5000); */
  }
  ngOnInit() {
    //
  }

  async loadSearchKeys() {
    if (!this.dbService.isDbReady()) {
      console.warn('[AppComponent] Database non ancora pronto, impossibile caricare i filtri');
      return;
    }

    this.availableKeys = await this.searchService.loadAvailableFilterKeys();
    this.groupedFilterKeys = this.searchService.groupFilterKeys(this.availableKeys);
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
    console.log('[AppComponent] Node clicked:', {
      name: node.name,
      type: node.type,
      fileId: node.fileId,
      documentId: node.documentId
    });
    
    if (node.type === 'folder') {
      node.expanded = !node.expanded;
      
      // If it's a document node (has documentId), select it to show metadata
      if (node.documentId) {
        console.log('[AppComponent] Selecting document node with ID:', node.documentId);
        this.selectedFile = node;
        this.integrityStatus = 'none';
        this.integrityVerifiedAt = null;
        this.metadata = null;
      } else {
        // Regular folder without document, deselect
        console.log('[AppComponent] Deselecting - regular folder');
        this.selectedFile = null;
        this.integrityStatus = 'none';
        this.integrityVerifiedAt = null;
        this.metadata = null;
      }
    } else {
      // File node selected
      console.log('[AppComponent] Selecting file node with ID:', node.fileId);
      this.selectedFile = node;
      this.integrityStatus = 'none'; 
      this.integrityVerifiedAt = null;

      if (!node.fileId) {
        console.error('File ID mancante per il nodo:', node);
        this.metadata = { error: 'File ID non disponibile.' };
        return;
      }

      // Carica lo stato di integrità salvato, se disponibile
      const storedStatus = await this.fileIntegrityService.getStoredStatus(node.fileId);
      if (storedStatus) {
        this.integrityStatus = storedStatus.result ? 'valid' : 'invalid';
        this.integrityVerifiedAt = storedStatus.verifiedAt;
        this.cdr.detectChanges();
      }
    }
    
    // Force change detection to update the view
    this.cdr.detectChanges();
  }

  async openFile(node: FileNode) {
    if (!node.fileId) {
      alert('File ID non disponibile.');
      return;
    }

    // Recupera il percorso fisico corretto dal servizio
    const physicalPath = await this.fileService.getPhysicalPath(node.fileId);
    console.log(`Percorso fisico recuperato per fileId ${node.fileId}:`, physicalPath);
    if (physicalPath) {
      console.log(`Apertura percorso fisico: ${physicalPath}`);
      // Apri il file in una nuova finestra Electron
      const result = await window.electronAPI.file.openInWindow(physicalPath);
      if (!result.success) {
        console.error(`Errore nell'apertura del file:`, result.error);
        console.log('Apertura nel browser utente esterno come fallback...');
        const externalResult = await window.electronAPI.file.openExternal(physicalPath);
      }
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

    const physicalPath = await this.fileService.getPhysicalPath(node.fileId);
    if (physicalPath) {
      // Usa Electron dialog per far scegliere all'utente dove salvare il file
      const result = await window.electronAPI.file.download(physicalPath);
      if (result.success) {
        alert('File salvato con successo in: ' + result.savedPath);
      } else if (!result.canceled) {
        alert('Errore durante il salvataggio: ' + result.error);
      }
      // Se canceled, l'utente ha annullato - non mostrare nulla
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
      const result = await this.fileIntegrityService.verifyFileIntegrity(node.fileId);
      this.integrityStatus = result.isValid ? 'valid' : 'invalid';
      this.integrityVerifiedAt = new Date().toISOString();
      
      // Save the verification result for future reference
      await this.fileIntegrityService.saveVerificationResult(node.fileId, result);
      
      this.cdr.detectChanges(); // Forza l'aggiornamento della UI prima dell'alert

      if (!result.isValid) {
        console.warn(`Hash mismatch! Atteso: ${result.expectedHash}, Calcolato: ${result.calculatedHash}`);
        setTimeout(() => {
          alert(`Attenzione: Hash non corrispondente!\n\nAtteso:\n${result.expectedHash}\n\nCalcolato:\n${result.calculatedHash}`);
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
      
      this.searchService.reindexAll().then(async () => {
         console.log('Indicizzazione AI completata con successo.');
         await window.electronAPI.utils.showMessage('Indicizzazione Completata! Ora puoi usare la ricerca semantica.', 'info');
      }).catch(err => {
         console.error('Errore AI:', err);
         window.electronAPI.utils.showMessage('Indicizzazione SQL ok, ma errore AI: ' + err.message, 'error');
      });
    } catch (error: any) {
      console.error('Error running indexer:', error);
      window.electronAPI.utils.showMessage('Errore durante l\'indicizzazione: ' + error.message, 'error');
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
  this.semanticResults = []; // Pulisci i risultati precedenti

  try {
    console.log('1. Richiesta embedding...');
    const vector = await this.searchService.getEmbeddingDebug(this.semanticQuery);
    
    console.log('2. Embedding ricevuto, lunghezza:', vector.length);
    this.generatedVector = vector;

    console.log('3. Esecuzione ricerca...');
    const rawResults = await this.searchService.searchSemantic(vector);
    
    if (rawResults.length === 0) {
      this.isCalculatingVector = false;
      return;
    }

    const ids = rawResults.map(r => r.id);
    
    // ✅ CORRETTO: Carica i DOCUMENTI, non i file
    const documentDetails = await this.dbService.getDocumentsByIds(ids);

    console.log('4. Risultati documenti:', documentDetails);
    this.semanticResults = documentDetails.map(doc => {
      const match = rawResults.find(r => r.id === doc.documentId);
      return {
        ...doc,
        score: match ? (match.score * 100).toFixed(1) + '%' : 'N/A'
      };
    });
    this.semanticResults.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));

  } catch (e: any) {
    console.error('ERRORE CRITICO:', e);
    alert('Errore AI: ' + e.message);
  } finally {
    this.isCalculatingVector = false;
    this.cdr.detectChanges();
  }
}

onSemanticResultClick(node: any) {
    this.handleNodeClick(node);
}
}