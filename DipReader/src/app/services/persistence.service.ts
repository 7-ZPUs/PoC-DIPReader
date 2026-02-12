import { Injectable } from '@angular/core';

/**
 * Servizio per persistenza del DB SQLite via IndexedDB.
 * Salva e carica il Blob del database in modo cross-session.
 */
@Injectable({ providedIn: 'root' })
export class PersistenceService {
  private readonly DB_NAME = 'dip-db';
  private readonly STORE_NAME = 'database';
  private readonly KEY = 'dip-database-blob';

  async saveDb(blob: Blob): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction([this.STORE_NAME], 'readwrite');
    const store = tx.objectStore(this.STORE_NAME);
    await new Promise((resolve, reject) => {
      const req = store.put(blob, this.KEY);
      req.onsuccess = () => resolve(undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    console.log('[PersistenceService] Database salvato in IndexedDB');
  }

  async loadDb(): Promise<Blob | null> {
    try {
      const db = await this.openDb();
      const tx = db.transaction([this.STORE_NAME], 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const blob = await new Promise<Blob | undefined>((resolve, reject) => {
        const req = store.get(this.KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      if (blob) {
        console.log('[PersistenceService] Database caricato da IndexedDB, size:', blob.size);
      }
      return blob || null;
    } catch (err) {
      console.warn('[PersistenceService] Errore caricamento da IndexedDB:', err);
      return null;
    }
  }

  async clearDb(): Promise<void> {
    try {
      const db = await this.openDb();
      const tx = db.transaction([this.STORE_NAME], 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      await new Promise((resolve, reject) => {
        const req = store.delete(this.KEY);
        req.onsuccess = () => resolve(undefined);
        req.onerror = () => reject(req.error);
      });
      db.close();
      console.log('[PersistenceService] Database cancellato da IndexedDB');
    } catch (err) {
      console.warn('[PersistenceService] Errore cancellazione:', err);
    }
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
