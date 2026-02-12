// db-handler.js - Main process database handler
const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class DatabaseHandler {
  constructor() {
    this.db = null;
    this.currentDipUUID = null;
    this.dbPath = path.join(app.getPath('userData'), 'databases');
    
    // Ensure database directory exists
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true });
    }
  }

  /**
   * Open or create a database for a specific DIP
   */
  openOrCreateDatabase(dipUUID) {
    const dbFileName = `${dipUUID}.sqlite3`;
    const fullPath = path.join(this.dbPath, dbFileName);
    const fileExists = fs.existsSync(fullPath);

    // Close current database if it's different
    if (this.db && this.currentDipUUID !== dipUUID) {
      try {
        this.db.close();
        console.log(`[DB Handler] Closed previous database: ${this.currentDipUUID}`);
      } catch (e) {
        console.warn('[DB Handler] Error closing database:', e);
      }
    }

    // Open or create the database
    this.db = new sqlite3(fullPath);
    this.currentDipUUID = dipUUID;

    console.log(`[DB Handler] ${fileExists ? 'Opened existing' : 'Created new'} database: ${dbFileName}`);

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS document_vectors (
          doc_id INTEGER PRIMARY KEY,
          embedding BLOB
        );
      `);
      console.log('[DB Handler] Tabella document_vectors verificata/creata.');
    } catch (e) {
      console.error('[DB Handler] Errore creazione tabella vettori:', e);
    }

    // If new database, create schema
    if (!fileExists) {
      this.createSchema();
    }

    return { success: true, dipUUID, existed: fileExists };
  }

  /**
   * Create database schema from schema.sql file
   */
  createSchema() {
    const schemaPath = path.join(__dirname, 'public', 'schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      // Try alternative path
      const altSchemaPath = path.join(__dirname, 'src', 'db', 'schema.sql');
      if (fs.existsSync(altSchemaPath)) {
        const schema = fs.readFileSync(altSchemaPath, 'utf-8');
        this.db.exec(schema);
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_vectors (
        doc_id INTEGER PRIMARY KEY,
        embedding BLOB
      );
    `);
        console.log('[DB Handler] Schema created from src/db/schema.sql');
        return;
      }
      throw new Error('Schema file not found');
    }

    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
    console.log('[DB Handler] Schema created');
  }

  saveVector(docId, vector) {
      if (!this.db) return;
      try {
          const buffer = Buffer.from(vector.buffer);
          this.db.prepare(
              'INSERT OR REPLACE INTO document_vectors (doc_id, embedding) VALUES (?, ?)'
          ).run(docId, buffer);
          //console.log(`[DB Handler] Saved vector for doc_id: ${docId}`);
      } catch (e) {
          console.error('[DB Handler] Error saving vector:', e);
      }
  }

  getAllVectors() {
      if (!this.db) return [];
      try {
          const rows = this.db.prepare('SELECT doc_id, embedding FROM document_vectors').all();
          // Converti i BLOB indietro in Float32Array
          return rows.map(row => ({
              id: row.doc_id,
              vector: new Float32Array(
                  row.embedding.buffer, 
                  row.embedding.byteOffset, 
                  row.embedding.byteLength / 4
              )
          }));
      } catch (e) {
          console.error('[DB Handler] Error loading vectors:', e);
          return [];
      }
  }
  /**
   * Clear all tables for re-indexing
   */
  clearTables() {
    if (!this.db) {
      throw new Error('No database open');
    }

    const tables = [
      'document_subject_association',
      'metadata',
      'file',
      'document',
      'aip',
      'document_class',
      'archival_process',
      'subject_pf',
      'subject_pg',
      'subject_pai',
      'subject_pae',
      'subject_as',
      'subject_sq',
      'subject',
      'phase',
      'document_aggregation',
      'administrative_procedure'
    ];

    for (const table of tables) {
      try {
        this.db.prepare(`DELETE FROM ${table}`).run();
      } catch (e) {
        console.warn(`[DB Handler] Error clearing table ${table}:`, e);
      }
    }

    console.log('[DB Handler] Tables cleared for re-indexing');
    return { success: true };
  }

  /**
   * Execute a SQL query
   */
  executeQuery(sql, params = []) {
    if (!this.db) {
      throw new Error('No database open');
    }

    try {
      const stmt = this.db.prepare(sql);
      
      // Determine if it's a SELECT query
      const isSelect = sql.trim().toLowerCase().startsWith('select');
      
      if (isSelect) {
        return stmt.all(...params);
      } else {
        return stmt.run(...params);
      }
    } catch (e) {
      console.error('[DB Handler] Query error:', e);
      throw e;
    }
  }

  /**
   * Execute SQL without returning results (for INSERT, UPDATE, DELETE)
   */
  exec(sql, params = []) {
    if (!this.db) {
      throw new Error('No database open');
    }

    try {
      const stmt = this.db.prepare(sql);
      return stmt.run(...params);
    } catch (e) {
      console.error('[DB Handler] Exec error:', e);
      throw e;
    }
  }

  /**
   * List all available databases
   */
  listDatabases() {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true });
        console.log('[DB Handler] Created databases directory');
        return [];
      }
      
      const files = fs.readdirSync(this.dbPath);
      const databases = files
        .filter(file => file.endsWith('.sqlite3'))
        .map(file => file.replace('.sqlite3', ''));
      
      console.log(`[DB Handler] Found ${databases.length} databases`);
      return databases;
    } catch (err) {
      console.error('[DB Handler] Error listing databases:', err);
      return [];
    }
  }

  /**
   * Delete a database
   */
  deleteDatabase(dipUUID) {
    try {
      const dbFileName = `${dipUUID}.sqlite3`;
      const fullPath = path.join(this.dbPath, dbFileName);

      // Close database if it's the current one
      if (this.currentDipUUID === dipUUID && this.db) {
        this.db.close();
        this.db = null;
        this.currentDipUUID = null;
      }

      fs.unlinkSync(fullPath);
      console.log(`[DB Handler] Deleted database: ${dbFileName}`);
      return { success: true };
    } catch (err) {
      console.error('[DB Handler] Error deleting database:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Export database to a file
   */
  exportDatabase(exportPath) {
    if (!this.db || !this.currentDipUUID) {
      throw new Error('No database open to export');
    }

    try {
      const sourceDb = path.join(this.dbPath, `${this.currentDipUUID}.sqlite3`);
      const targetPath = exportPath || path.join(app.getPath('downloads'), `${this.currentDipUUID}.sqlite3`);
      
      fs.copyFileSync(sourceDb, targetPath);
      console.log(`[DB Handler] Database exported to: ${targetPath}`);
      return { success: true, path: targetPath };
    } catch (err) {
      console.error('[DB Handler] Error exporting database:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get current database info
   */
  getDatabaseInfo() {
    if (!this.db || !this.currentDipUUID) {
      return { open: false };
    }

    try {
      const fileCount = this.db.prepare('SELECT COUNT(*) as count FROM file').get();
      const documentCount = this.db.prepare('SELECT COUNT(*) as count FROM document').get();
      
      return {
        open: true,
        dipUUID: this.currentDipUUID,
        fileCount: fileCount.count,
        documentCount: documentCount.count
      };
    } catch (e) {
      return { open: true, dipUUID: this.currentDipUUID, error: e.message };
    }
  }

  /**
   * Close current database
   */
  close() {
    if (this.db) {
      try {
        this.db.close();
        console.log('[DB Handler] Database closed');
      } catch (e) {
        console.error('[DB Handler] Error closing database:', e);
      }
      this.db = null;
      this.currentDipUUID = null;
    }
  }
}

module.exports = new DatabaseHandler();
