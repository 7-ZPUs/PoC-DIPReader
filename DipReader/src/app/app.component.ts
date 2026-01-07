import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DipReaderService, FileNode } from './dip-reader.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
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
  `]
})
export class AppComponent implements OnInit {
  fileTree: FileNode[] = [];
  
  // --- PROPRIETÀ REINSERITE PER EVITARE L'ERRORE ---
  selectedFile: FileNode | null = null;
  metadata: any = null;
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
        this.cdr.detectChanges(); 
      },
      error: (err) => {
        console.error('ERRORE GRAVE durante il caricamento del pacchetto:', err);
      }
    });
  }

  async handleNodeClick(node: FileNode) {
    if (node.type === 'folder') {
      node.expanded = !node.expanded;
      // Deseleziona il file quando si interagisce con le cartelle
      this.selectedFile = null;
      this.metadata = null;
    } else {
      // Imposta il file selezionato così la parte destra si aggiorna
      this.selectedFile = node;
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
      window.open(physicalPath, '_blank');
    } else {
      console.error(`Impossibile trovare il percorso fisico per il percorso logico: ${node.path}`);
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