import { Injectable } from '@angular/core';
import { DatabaseService } from '../database-electron.service';

/**
 * Gestione delle operazioni sui file
 * Centralizza l'accesso ai percorsi fisici e lettura file
 */
@Injectable({ providedIn: 'root' })
export class FileService {
  constructor(private dbService: DatabaseService) {}

  /**
   * Get the physical path for a file from database
   */
  async getPhysicalPath(fileId: number): Promise<string | undefined> {
    const rows = await this.dbService.executeQuery<Array<{
      root_path: string;
    }>>(`
      SELECT root_path
      FROM file
      WHERE id = ?
    `, [fileId]);

    if (rows.length === 0) {
      return undefined;
    }

    // Build the full path combining DIP root and file path
    const filePath = rows[0].root_path;
    const currentDipPath = this.dbService.getCurrentDipPath();
    
    if (!currentDipPath) {
      console.warn('Current DIP path not set, returning relative path');
      return filePath;
    }

    // Combine paths
    return `${currentDipPath}/${filePath}`;
  }

  /**
   * Get document subjects for a given document
   */
  async getDocumentSubjects(documentId: number): Promise<any[]> {
    const rows = await this.dbService.executeQuery<any[]>(`
      SELECT 
        dsa.role,
        s.id as subject_id,
        pf.first_name as pf_first_name,
        pf.last_name as pf_last_name,
        pf.cf as pf_cf,
        pg.denomination as pg_denomination,
        pg.piva as pg_piva
      FROM document_subject_association dsa
      JOIN subject s ON s.id = dsa.subject_id
      LEFT JOIN subject_pf pf ON pf.subject_id = s.id
      LEFT JOIN subject_pg pg ON pg.subject_id = s.id
      WHERE dsa.document_id = ?
    `, [documentId]);

    return rows;
  }

  /**
   * Get administrative procedures for a document
   */
  async getDocumentProcedures(documentId: number): Promise<any[]> {
    const rows = await this.dbService.executeQuery<any[]>(`
      SELECT 
        ap.catalog_uri,
        ap.title,
        ap.subject_of_interest,
        p.phase_type,
        p.start_date,
        p.end_date
      FROM document d
      LEFT JOIN administrative_procedure ap ON ap.id IN (
        SELECT procedure_id FROM phase WHERE procedure_id = ap.id
      )
      LEFT JOIN phase p ON p.procedure_id = ap.id
      WHERE d.id = ?
    `, [documentId]);

    return rows;
  }
}
