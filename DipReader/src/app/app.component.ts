import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DipReaderService, FileNode } from './dip-reader.service';
import { MetadataViewerComponent } from './metadata-viewer.component';
import { Filter } from './filter-manager';
import { IndexerService } from './indexer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MetadataViewerComponent, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.css']
})
export class AppComponent implements OnInit {
  fileTree: FileNode[] = [];
  
  // --- PROPRIETÀ REINSERITE PER EVITARE L'ERRORE ---
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
  integrityStatus: 'none' | 'loading' | 'valid' | 'invalid' | 'error' = 'none';
  integrityVerifiedAt: string | null = null;
  // -------------------------------------------------

  constructor(
    private dipService: DipReaderService,
    private cdr: ChangeDetectorRef,
    private indexerService: IndexerService
  ) {}

  ngOnInit() {
    this.dipService.loadPackage().subscribe({
      next: (tree) => {
        console.log('AppComponent: Pacchetto caricato, albero ricevuto.', tree);
        this.fileTree = tree;
        this.loadSearchKeys(); // Carica le chiavi per i filtri
        this.cdr.detectChanges(); 
      },
      error: (err) => {
        console.error('ERRORE GRAVE durante il caricamento del pacchetto:', err);
      }
    });
  }

  async loadSearchKeys() {
    this.availableKeys = await this.dipService.getAvailableMetadataKeys();
    this.groupedFilterKeys = await this.dipService.getGroupedFilterKeys();
    console.log('Filtri raggruppati caricati:', this.groupedFilterKeys.length, 'gruppi');
  }

  addFilter() {
    this.filters.push({ key: '', value: '' });
  }

  removeFilter(index: number) {
    this.filters.splice(index, 1);
  }

  async performSearch() {
    this.isSearching = true;
    // Pulisce la selezione corrente
    this.selectedFile = null;
    this.metadata = null;
    
    this.fileTree = await this.dipService.searchDocuments(this.searchName, this.filters);
    this.cdr.detectChanges();
  }

  clearSearch() {
    this.searchName = '';
    this.filters = [];
    this.isSearching = false;
    // Ricarica l'albero completo
    this.dipService.loadPackage().subscribe(tree => {
      this.fileTree = tree;
      this.cdr.detectChanges();
    });
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
      
      // Recupera i metadati in modo ASINCRONO dal database
      this.metadata = await this.dipService.getMetadataForFile(node.path);
      console.log(`Metadati per '${node.path}':`, this.metadata);
      
      // Carica lo stato di integrità salvato, se disponibile
      const storedStatus = await this.dipService.getStoredIntegrityStatus(node.path);
      if (storedStatus) {
        this.integrityStatus = storedStatus.valid ? 'valid' : 'invalid';
        this.integrityVerifiedAt = storedStatus.verifiedAt;
        this.cdr.detectChanges();
      }
    }
  }

  // --- FUNZIONI REINSERITE PER EVITARE L'ERRORE ---
  async openFile(node: FileNode) {
    // Recupera il percorso fisico corretto dal servizio
    const physicalPath = await this.dipService.getPhysicalPathForFile(node.path);
    if (physicalPath) {
      console.log(`Apertura percorso fisico: ${physicalPath}`);
      // Apre il file in una nuova scheda
      window.open(physicalPath, '_blank');
    } else {
      console.error(`Impossibile trovare il percorso fisico per il percorso logico: ${node.path}`);
      alert('File non trovato o percorso mancante.');
    }
  }

  async downloadFile(node: FileNode) {
    const physicalPath = await this.dipService.getPhysicalPathForFile(node.path);
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
    this.integrityStatus = 'loading';
    this.integrityVerifiedAt = null;
    try {
      const result = await this.dipService.verifyFileIntegrity(node.path);
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
    this.dipService.downloadDebugDb();
  }

  async runIndexer() {
    try {
      await this.indexerService.runIndexer();
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
}