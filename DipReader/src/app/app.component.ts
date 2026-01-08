import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DipReaderService, FileNode } from './dip-reader.service';
import { MetadataViewerComponent } from './metadata-viewer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MetadataViewerComponent, FormsModule],
  template: `
    <div class="container">
      <div class="sidebar">
        <h3>Esplora DIP</h3>
        <!-- Pannello di Ricerca -->
        <div class="search-box">
          <input type="text" [(ngModel)]="searchName" placeholder="Cerca nome file..." (keyup.enter)="performSearch()" class="search-input">
          
          <div *ngFor="let filter of filters; let i = index" class="filter-row">
            <select [(ngModel)]="filter.key" class="filter-select">
              <option value="" disabled selected>Seleziona campo...</option>
              <option *ngFor="let key of availableKeys" [value]="key">{{ key }}</option>
            </select>
            <input type="text" [(ngModel)]="filter.value" placeholder="Valore..." class="filter-input">
            <button (click)="removeFilter(i)" class="btn-icon remove">×</button>
          </div>

          <div class="search-actions">
            <button (click)="addFilter()" class="btn-small">+ Filtro</button>
            <div class="right-actions">
              <button (click)="performSearch()" class="btn-primary">Cerca</button>
              <button *ngIf="isSearching" (click)="clearSearch()" class="btn-secondary">Reset</button>
            </div>
          </div>
        </div>

        <hr> <button (click)="downloadDb()" style="margin-bottom: 10px; cursor: pointer; font-size: 0.8rem;">💾 Scarica DB Debug</button>
        
        <ng-template #recursiveList let-list>
          <ul>
            <li *ngFor="let node of list">
              <div (click)="handleNodeClick(node)" 
                   [class.is-folder]="node.type === 'folder'"
                   [class.is-file]="node.type === 'file'"
                   [style.font-weight]="node === selectedFile ? 'bold' : 'normal'">
                <span *ngIf="node.type === 'folder'">{{ node.expanded ? '📂' : '📁' }}</span>
                <span *ngIf="node.type === 'file'">📄</span>
                {{ node.name }}
              </div>
              <div *ngIf="node.type === 'folder' && node.expanded">
                <ng-container *ngTemplateOutlet="recursiveList; context:{ $implicit: node.children }"></ng-container>
              </div>
            </li>
          </ul>
        </ng-template>

        <ng-container *ngTemplateOutlet="recursiveList; context:{ $implicit: fileTree }"></ng-container>
      </div>

      <div class="main">
        <div *ngIf="selectedFile; else noFile">
          <h2>{{ selectedFile.name }}</h2>
          <div style="margin-bottom: 15px; display: flex; gap: 10px;">
            <button (click)="openFile(selectedFile)">Apri in Nuova Scheda</button>
            <button (click)="downloadFile(selectedFile)">Scarica File</button>
            <button (click)="checkIntegrity(selectedFile)">Verifica Integrità</button>
            <span *ngIf="integrityStatus === 'loading'" class="badge loading">Verifica in corso...</span>
            <span *ngIf="integrityStatus === 'valid'" class="badge success">✔ Integro (SHA-256)</span>
            <span *ngIf="integrityStatus === 'invalid'" class="badge error">✖ Corrotto</span>
          </div>
          <app-metadata-viewer [logicalPath]="selectedFile.path"></app-metadata-viewer>
        </div>
        <ng-template #noFile>
          <p>Seleziona un file dall'albero per visualizzarne i dettagli.</p>
        </ng-template>
      </div>
    </div>
  `,
  styles: [`
    .container { display: flex; height: 100vh; font-family: sans-serif; }
    .sidebar { width: 400px; border-right: 1px solid #ccc; overflow-y: auto; padding: 10px; background: #f5f5f5; flex-shrink: 0; }
    .main { flex: 1; padding: 20px; overflow-x: auto; min-width: 0; }
    ul { list-style-type: none; padding-left: 20px; }
    li { cursor: pointer; margin: 2px 0; }
    .is-folder { font-weight: bold; color: #333; }
    .is-file { color: #0066cc; }
    .metadata-box { background: #fff; padding: 15px; border: 1px solid #ddd; margin-top: 20px; }
    .metadata-box pre { white-space: pre-wrap; word-break: break-all; }
    .error-box { border-color: #d9534f; color: #d9534f; background-color: #f2dede; }
    
    /* Stili Ricerca */
    .search-box { background: #e9ecef; padding: 10px; border-radius: 4px; margin-bottom: 10px; }
    .search-input, .filter-select, .filter-input { width: 100%; padding: 5px; margin-bottom: 5px; box-sizing: border-box; }
    .filter-row { display: flex; gap: 5px; margin-bottom: 5px; align-items: center; }
    .filter-select { flex: 1; min-width: 0; }
    .filter-input { flex: 1; min-width: 0; }
    .search-actions { display: flex; justify-content: space-between; margin-top: 5px; }
    .right-actions { display: flex; gap: 5px; }
    .btn-small { font-size: 0.8rem; padding: 2px 5px; }
    .btn-primary { background-color: #007bff; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; }
    .btn-secondary { background-color: #6c757d; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; }
    .btn-icon.remove { background: none; border: none; color: #dc3545; font-weight: bold; cursor: pointer; font-size: 1.2rem; line-height: 1; }
    
    /* Badge Integrità */
    .badge { padding: 6px 12px; border-radius: 4px; font-size: 0.85rem; display: flex; align-items: center; font-weight: bold; color: white; }
    .loading { background-color: #ffc107; color: #333; }
    .success { background-color: #28a745; }
    .error { background-color: #dc3545; }
  `]
})
export class AppComponent implements OnInit {
  fileTree: FileNode[] = [];
  
  // --- PROPRIETÀ REINSERITE PER EVITARE L'ERRORE ---
  selectedFile: FileNode | null = null;
  metadata: any = null;
  
  // Proprietà per la ricerca
  searchName = '';
  availableKeys: string[] = [];
  filters: { key: string, value: string }[] = [];
  isSearching = false;
  integrityStatus: 'none' | 'loading' | 'valid' | 'invalid' | 'error' = 'none';
  // -------------------------------------------------

  constructor(
    private dipService: DipReaderService,
    private cdr: ChangeDetectorRef 
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
      this.metadata = null;
    } else {
      // Imposta il file selezionato così la parte destra si aggiorna
      this.selectedFile = node;
      this.integrityStatus = 'none'; // Resetta lo stato della verifica per il nuovo file
      // Recupera i metadati in modo ASINCRONO dal database
      this.metadata = await this.dipService.getMetadataForFile(node.path);
      console.log(`Metadati per '${node.path}':`, this.metadata);
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
    try {
      const result = await this.dipService.verifyFileIntegrity(node.path);
      this.integrityStatus = result.valid ? 'valid' : 'invalid';
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
      alert('Errore durante la verifica: ' + err.message);
    }
  }

  downloadDb() {
    this.dipService.downloadDebugDb();
  }

  getFilesList(fileInfo: any): any[] {
    if (!fileInfo) return [];
    return Array.isArray(fileInfo) ? fileInfo : [fileInfo];
  }
  // -------------------------------------------------
}