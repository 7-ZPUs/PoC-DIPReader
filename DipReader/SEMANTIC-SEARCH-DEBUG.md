# Troubleshooting: Ricerca Semantica Restituisce 0 Risultati

## Problema

La ricerca semantica non restituisce risultati anche quando la query dovrebbe corrispondere.

---

## Checklist di Diagnostica

### 1. ✅ **Verifica che i documenti siano stati indicizzati**

**Controlla i log durante l'indicizzazione:**

```
[Semantic] Processing 150 documents...
[DB Handler] ✅ Saved vector for doc_id: 1 in vss_documents (384 dimensions)
[DB Handler] ✅ Saved vector for doc_id: 2 in vss_documents (384 dimensions)
...
[Semantic] Semantic indexing completed: 150/150 documents indexed
```

**Se vedi:**
- ❌ `Processing 0 documents` → Nessun documento nel DB
- ❌ `Error saving vector` → Problema con sqlite-vss

**Soluzione:** Re-indicizza il DIP usando "Index Directory" nella UI.

---

### 2. ✅ **Verifica che sqlite-vss sia caricato**

**Cerca nel log all'apertura del database:**

```
[DB Handler] ✅ sqlite-vss extension loaded successfully - using optimized vector search
```

**Se vedi:**
```
[DB Handler] ❌ Error loading sqlite-vss extension: ...
[DB Handler] ⚠️ Falling back to BLOB storage (brute-force search)
```

**Possibili cause:**
- sqlite-vss non installato: `npm install sqlite-vss`
- Binari nativi non compilati: `npm run electron:rebuild`
- Architettura incompatibile (ARM vs x64)

---

### 3. ✅ **Verifica il numero di vettori indicizzati**

**Durante la ricerca, controlla il log:**

```
[DB Handler] Searching among 150 indexed vectors (VSS: true)
```

**Se vedi:**
- `Searching among 0 indexed vectors` → Database vuoto, re-indicizza
- `(VSS: false)` → sqlite-vss non caricato, vedi punto 2

---

### 4. ✅ **Verifica che la query generi un embedding valido**

**Cerca nei log della ricerca:**

```
[AI Search] Generating embedding for query: "tramonto mare"
[AI Search] Generated query vector: 384 dimensions, first 3 values: [0.0234, -0.1567, 0.0891]
```

**Se vedi:**
- `Error creating embedding` → Modello AI non caricato
- Dimensioni diverse da 384 → Problema con il modello

**Soluzione:** Verifica che `assets/models/Xenova/all-MiniLM-L6-v2/` esista.

---

### 5. ✅ **Verifica i risultati della query sqlite-vss**

**Cerca il log:**

```
[DB Handler] sqlite-vss returned 15 results
[DB Handler] Top result: id=42, distance=0.1234
```

**Se vedi:**
- `sqlite-vss returned 0 results` → Query non trova corrispondenze
- SQL error → Sintassi query errata

**Possibili cause:**
- Soglia di similarità troppo alta
- Vettori non normalizzati
-Sintassi `vss_search()` errata

---

### 6. ⚠️ **PROBLEMA COMUNE: Sintassi sqlite-vss**

La sintassi corretta per sqlite-vss dipende dalla versione. Attualmente usiamo:

```sql
SELECT rowid as id, distance
FROM vss_documents
WHERE vss_search(embedding, ?)
LIMIT ?
```

**Se non funziona, prova sintassi alternativa:**

```sql
-- Opzione 2: Con parametri espliciti
SELECT rowid, distance
FROM vss_documents
WHERE vss_search(
  embedding, 
  vss_search_params(?, 20)
)

-- Opzione 3: Senza WHERE (alcune versioni)
SELECT rowid, distance  
FROM vss_search(vss_documents, ?, 20)
```

**Per testare manualmente:**

```bash
# Apri il database
sqlite3 ~/.config/DipReader/databases/YOUR_DIP.sqlite3

# Carica estensioni
.load /path/to/vector0
.load /path/to/vss0

# Conta vettori
SELECT COUNT(*) FROM vss_documents;

# Test di ricerca (con vettore dummy)
SELECT rowid, distance 
FROM vss_documents 
WHERE vss_search(embedding, '[0.1, 0.2, ...]')
LIMIT 5;
```

---

### 7. ✅ **Verifica corrispondenza ID**

I `rowid` in `vss_documents` devono corrispondere agli `id` dei documenti.

**Verifica manualmente:**

```sql
-- Dovrebbero essere uguali
SELECT COUNT(*) FROM document;
SELECT COUNT(*) FROM vss_documents;

-- I rowid devono corrispondere a document.id
SELECT rowid FROM vss_documents LIMIT 10;
SELECT id FROM document LIMIT 10;
```

**Se non corrispondono:** Re-indicizza completamente.

---

### 8. ✅ **Test con query semplice**

Prova una query che sicuramente dovrebbe funzionare:

1. Verifica il testo di un documento nel DB
2. Copia esattamente quel testo
3. Usalo come query di ricerca

**Se anche questo restituisce 0 risultati:** Problema con la similarity metric o con la normalizzazione vettori.

---

## Soluzione Rapida

Se nessuna delle precedenti funziona:

### Opzione A: Rimuovere sqlite-vss e usare sqlite-vec

```bash
npm uninstall sqlite-vss
npm install sqlite-vec
```

Poi modificare `db-handler.js` per usare sqlite-vec (sintassi diversa).

### Opzione B: Fallback a ricerca brute-force

In `db-handler.js`, forza il fallback:

```javascript
this.vssEnabled = false; // Forza BLOB storage
```

Sarà più lento ma funzionerà sempre.

---

## Log di Esempio (Tutto OK)

```
[IPC] Opening database for DIP: test-dip-001
[DB Handler] Opened existing database: test-dip-001.sqlite3
[DB Handler] ✅ sqlite-vss extension loaded successfully

[AI Search] Initializing model...
[AI Search] Model loaded successfully

[IPC] Indexing DIP...
[Semantic] Processing 150 documents...
[DB Handler] ✅ Saved vector for doc_id: 1 in vss_documents (384 dimensions)
...
[Semantic] Semantic indexing completed: 150/150 documents indexed

[AI Search] Search query type: string length: 12
[AI Search] Generating embedding for query: "tramonto mare"
[AI Search] Generated query vector: 384 dimensions, first 3 values: [0.023, -0.156, 0.089]
[DB Handler] Searching among 150 indexed vectors (VSS: true)
[DB Handler] Query vector length: 384, first 3 values: [0.023, -0.156, 0.089]
[DB Handler] sqlite-vss returned 15 results
[DB Handler] Top result: id=42, distance=0.1234
[AI Search] Found 15 results via database search
[AI Search] Top 3 results: id=42 score=0.8766, id=18 score=0.8123, id=99 score=0.7845
```

---

## Contatti per Supporto

Se il problema persiste dopo aver seguito questa guida, raccogli:
1. Log completo della console
2. Output di `SELECT COUNT(*) FROM vss_documents`
3. Versione di Node.js e Electron
4. Sistema operativo (WSL? Linux? Windows?)
