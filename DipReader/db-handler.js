// db-handler.js - Main process database handler
const sqlite3 = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

class DatabaseHandler {
  constructor() {
    this.db = null;
    this.currentDipUUID = null;
    this.dbPath = null; // Initialize later when app is ready
    this.vssEnabled = false; // Track if sqlite-vss is available
  }

  /**
   * Initialize database path - must be called after Electron app is ready
   */
  _ensureDbPath() {
    if (!this.dbPath) {
      this.dbPath = path.join(app.getPath('userData'), 'databases');
      // Ensure database directory exists
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true });
      }
    }
  }

  /**
   * Open or create a database for a specific DIP
   */
  async openOrCreateDatabase(dipUUID) {
    this._ensureDbPath(); // Ensure path is initialized
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

    // Load sqlite-vss extension for vector similarity search
    this.vssEnabled = false; // Reset flag
    try {
      const sqliteVss = await import('sqlite-vss');

      // Get paths to extension files (these include .so extension)
      const vectorPath = sqliteVss.getVectorLoadablePath();
      const vssPath = sqliteVss.getVssLoadablePath();

      // Strip extension suffix for better-sqlite3 (it auto-appends .so)
      const stripExtension = (p) => p.replace(/\.(so|dylib|dll)$/, '');

      this.db.loadExtension(stripExtension(vectorPath));
      this.db.loadExtension(stripExtension(vssPath));

      // Create virtual table for vector search using vss0
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vss_documents USING vss0(
          embedding(384)
        );
      `);

      this.vssEnabled = true;
      console.log('[DB Handler] ✅ sqlite-vss extension loaded successfully - using optimized vector search');
    } catch (e) {
      console.error('[DB Handler] ❌ Error loading sqlite-vss extension:', e.message);
      console.warn('[DB Handler] ⚠️  Falling back to BLOB storage (brute-force search)');

      // Fallback: create simple blob table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS document_vectors (
          doc_id INTEGER PRIMARY KEY,
          embedding BLOB
        );
      `);
    }

    // If new database, create schema
    if (!fileExists) {
      this.createSchema();
    }

    return { success: true, dipUUID, existed: fileExists };
  }

  /**
   * Create database schema from schema.sql file
   * schema.sql is in the root directory alongside other Node.js files (main.js, db-handler.js)
   */
  createSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');

    if (!fs.existsSync(schemaPath)) {
      // Try legacy path for backward compatibility
      const legacySchemaPath = path.join(__dirname, 'public', 'schema.sql');
      if (fs.existsSync(legacySchemaPath)) {
        const schema = fs.readFileSync(legacySchemaPath, 'utf-8');
        this.db.exec(schema);
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_vectors (
        doc_id INTEGER PRIMARY KEY,
        embedding BLOB
      );
    `);
        console.log('[DB Handler] Schema created from legacy public/schema.sql');
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
      if (this.vssEnabled) {
        // Use sqlite-vss
        const vectorArray = Array.from(vector);
        const vectorJson = JSON.stringify(vectorArray);

        this.db.prepare('DELETE FROM vss_documents WHERE rowid = ?').run(docId);
        this.db.prepare('INSERT INTO vss_documents(rowid, embedding) VALUES (?, ?)').run(docId, vectorJson);
        
        console.log(`[DB Handler] ✅ Saved vector for doc_id: ${docId} in vss_documents (${vectorArray.length} dimensions)`);
      } else {
        // Fallback: BLOB storage
        const buffer = Buffer.from(vector.buffer);
        this.db.prepare('INSERT OR REPLACE INTO document_vectors (doc_id, embedding) VALUES (?, ?)').run(docId, buffer);
        
        console.log(`[DB Handler] ✅ Saved vector for doc_id: ${docId} in document_vectors (BLOB fallback)`);
      }

      //console.log(`[DB Handler] Saved vector for doc_id: ${docId}`);
    } catch (e) {
      console.error('[DB Handler] Error saving vector:', e);
    }
  }

  getAllVectors() {
    if (!this.db) return [];

    try {
      let rows;
      if (this.vssEnabled) {
        rows = this.db.prepare('SELECT rowid as doc_id FROM vss_documents').all();
      } else {
        rows = this.db.prepare('SELECT doc_id FROM document_vectors').all();
      }

      console.log(`[DB Handler] Loaded ${rows.length} vector entries`);
      return rows.map(row => ({ id: row.doc_id }));
    } catch (e) {
      console.error('[DB Handler] Error loading vectors:', e);
      return [];
    }
  }

  /**
   * Search for similar vectors using sqlite-vss (or fallback to brute-force)
   */
  searchVectors(queryVector, limit = 20) {
    if (!this.db) return [];

    try {
      // Debug: Check how many vectors exist
      const vectorCount = this.vssEnabled 
        ? this.db.prepare('SELECT COUNT(*) as count FROM vss_documents').get().count
        : this.db.prepare('SELECT COUNT(*) as count FROM document_vectors').get().count;
      
      console.log(`[DB Handler] Searching among ${vectorCount} indexed vectors (VSS: ${this.vssEnabled})`);

      if (this.vssEnabled) {
        // Use optimized sqlite-vss search
        const vectorArray = Array.from(queryVector);
        const vectorJson = JSON.stringify(vectorArray);

        console.log(`[DB Handler] Query vector length: ${vectorArray.length}, first 3 values:`, vectorArray.slice(0, 3));

        const results = this.db.prepare(`
                  SELECT rowid as id, distance
                  FROM vss_documents
                  WHERE vss_search(embedding, ?)
                  LIMIT ?
              `).all(vectorJson, limit);

        console.log(`[DB Handler] sqlite-vss returned ${results.length} results`);
        if (results.length > 0) {
          console.log(`[DB Handler] Top result: id=${results[0].id}, distance=${results[0].distance}`);
        }

        // Convert distance to similarity score (lower distance = higher similarity)
        return results.map(row => ({
          id: row.id,
          score: 1 - row.distance
        }));
      } else {
        // Fallback: brute-force search with BLOB vectors
        console.warn('[DB Handler] Using fallback brute-force vector search (slower)');

        const rows = this.db.prepare('SELECT doc_id, embedding FROM document_vectors').all();
        const results = [];

        for (const row of rows) {
          const docVector = new Float32Array(
            row.embedding.buffer,
            row.embedding.byteOffset,
            row.embedding.byteLength / 4
          );

          // Cosine similarity (vectors are normalized)
          let dotProduct = 0;
          for (let i = 0; i < queryVector.length; i++) {
            dotProduct += queryVector[i] * docVector[i];
          }

          const score = dotProduct;
          if (score > 0.25) {
            results.push({ id: row.doc_id, score });
          }
        }

        // Sort by score descending and return top N
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
      }
    } catch (e) {
      console.error('[DB Handler] Error searching vectors:', e);
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

    // Clear vector search table
    try {
      if (this.vssEnabled) {
        this.db.prepare(`DELETE FROM vss_documents`).run();
        console.log('[DB Handler] Vector search table (vss) cleared');
      } else {
        this.db.prepare(`DELETE FROM document_vectors`).run();
        console.log('[DB Handler] Vector storage table (blob) cleared');
      }
    } catch (e) {
      console.warn('[DB Handler] Error clearing vector table:', e);
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
    this._ensureDbPath(); // Ensure path is initialized
    
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

      // Get vector count
      let vectorCount = 0;
      try {
        if (this.vssEnabled) {
          const result = this.db.prepare('SELECT COUNT(*) as count FROM vss_documents').get();
          vectorCount = result.count;
        } else {
          const result = this.db.prepare('SELECT COUNT(*) as count FROM document_vectors').get();
          vectorCount = result.count;
        }
      } catch (e) {
        console.warn('[DB Handler] Error getting vector count:', e);
      }

      return {
        open: true,
        dipUUID: this.currentDipUUID,
        fileCount: fileCount.count,
        documentCount: documentCount.count,
        vectorCount: vectorCount,
        vssEnabled: this.vssEnabled
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
