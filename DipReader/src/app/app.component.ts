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
    .sidebar { width: 400px; border-right: 1px solid #ccc; overflow-y: auto; padding: 10px; background: #f5f5f5; }
    .main { flex: 1; padding: 20px; } /* Aggiunto stile per la parte destra */
    ul { list-style-type: none; padding-left: 20px; }
    li { cursor: pointer; margin: 2px 0; }
    .is-folder { font-weight: bold; color: #333; }
    .is-file { color: #0066cc; }
    .metadata-box { background: #fff; padding: 15px; border: 1px solid #ddd; margin-top: 20px; }
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
    this.dipService.loadFileSystem().subscribe({
      next: (tree) => {
        console.log('AppComponent ha ricevuto l\'albero:', tree);
        this.fileTree = tree;
        this.cdr.detectChanges(); 
      },
      error: (err) => {
        console.error('ERRORE GRAVE:', err);
      }
    });
  }

  handleNodeClick(node: FileNode) {
    if (node.type === 'folder') {
      node.expanded = !node.expanded;
    } else {
      // Imposta il file selezionato così la parte destra si aggiorna
      this.selectedFile = node;
      console.log("Hai cliccato il file:", node.path);
    }
  }

  // --- FUNZIONI REINSERITE PER EVITARE L'ERRORE ---
  openFile(node: FileNode) {
    if (node && node.path) {
      // Apre il file in una nuova scheda
      window.open(node.path, '_blank');
    }
  }

  getFilesList(fileInfo: any): any[] {
    if (!fileInfo) return [];
    return Array.isArray(fileInfo) ? fileInfo : [fileInfo];
  }
  // -------------------------------------------------
}