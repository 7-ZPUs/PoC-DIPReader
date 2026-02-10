import { Component, Input, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DatabaseService } from './database-electron.service';

@Component({
  selector: 'app-metadata-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './metadata-viewer.component.html',
  styleUrls: ['./metadata-viewer.component.css']
})
export class MetadataViewerComponent implements OnChanges {
  @Input() fileId: number | undefined = undefined;
  attributes: { key: string, value: string }[] = [];
  loading = false;

  constructor(private dbService: DatabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnChanges(changes: SimpleChanges) {
    if (changes['fileId']) {
      if (this.fileId) {
        this.loading = true;
        this.cdr.detectChanges(); // Forza l'aggiornamento per mostrare "Caricamento..."
        try {
          this.attributes = await this.dbService.getMetadataAttributes(this.fileId);
        } catch (err) {
          console.error('Errore recupero metadati:', err);
          this.attributes = [];
        } finally {
          this.loading = false;
          this.cdr.detectChanges(); // Forza l'aggiornamento per mostrare i dati
        }
      } else {
        this.attributes = [];
      }
    }
  }
}