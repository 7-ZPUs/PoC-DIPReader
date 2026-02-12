import { Component, Input, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MetadataService } from './services/metadata.service';

@Component({
  selector: 'app-metadata-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './metadata-viewer.component.html',
  styleUrls: ['./metadata-viewer.component.css']
})
export class MetadataViewerComponent implements OnChanges {
  @Input() fileId: number | undefined = undefined;
  @Input() documentId: number | undefined = undefined;
  attributes: { key: string, value: string }[] = [];
  loading = false;

  constructor(private metadataService: MetadataService, private cdr: ChangeDetectorRef) {}

  async ngOnChanges(changes: SimpleChanges) {
    // Clear previous data
    this.attributes = [];
    
    if (changes['fileId'] || changes['documentId']) {
      console.log('[MetadataViewer] Changes detected - fileId:', this.fileId, 'documentId:', this.documentId);
      
      // Priority: if fileId is provided, use it, otherwise use documentId
      if (this.fileId !== undefined && this.fileId !== null) {
        this.loading = true;
        this.cdr.detectChanges();
        try {
          console.log('[MetadataViewer] Loading file metadata for fileId:', this.fileId);
          const fileId = this.fileId; // TypeScript type narrowing
          this.attributes = await this.metadataService.getMetadataAttributes(fileId);
          console.log('[MetadataViewer] Loaded', this.attributes.length, 'attributes for file');
        } catch (err) {
          console.error('Errore recupero metadati file:', err);
          this.attributes = [];
        } finally {
          this.loading = false;
          this.cdr.detectChanges();
        }
      } else if (this.documentId !== undefined && this.documentId !== null) {
        this.loading = true;
        this.cdr.detectChanges();
        try {
          console.log('[MetadataViewer] Loading document metadata for documentId:', this.documentId);
          const documentId = this.documentId; // TypeScript type narrowing
          this.attributes = await this.metadataService.getDocumentMetadata(documentId);
          console.log('[MetadataViewer] Loaded', this.attributes.length, 'attributes for document');
        } catch (err) {
          console.error('Errore recupero metadati documento:', err);
          this.attributes = [];
        } finally {
          this.loading = false;
          this.cdr.detectChanges();
        }
      }
    }
  }
}