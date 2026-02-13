# DipReader

Proof of Concept del Capitolato C3 - "DIP Reader: Applicazione per la gestione e consultazione di archivi DIP"

---

## Dipendenze

### Tecnologie Principali

| Tecnologia | Versione | Descrizione |
|-----------|----------|-------------|
| **Node.js** | ≥18.0.0 | Runtime JavaScript |
| **Angular** | 21.0.0 | Framework frontend |
| **Electron** | 40.2.1 | Framework per app desktop |
| **TypeScript** | 5.9.2 | Linguaggio di programmazione (frontend + backend) |

### Dipendenze Core

| Libreria | Versione | Utilizzo |
|----------|----------|----------|
| `better-sqlite3` | 12.6.2 | Database SQLite nativo |
| `@xenova/transformers` | 2.17.2 | Machine Learning (embeddings) |
| `onnxruntime-node` | 1.20.1 | Runtime per modelli ONNX |
| `fast-xml-parser` | 5.3.3 | Parser XML per metadati DIP |

## Installazione Locale

### Prerequisiti

1. **Node.js** (versione 18 o superiore)
   ```bash
   node --version  # Verifica versione
   ```

2. **npm** (versione 10 o superiore)
   ```bash
   npm --version   # Verifica versione
   ```
### Passi di Installazione

1. **Clone del repository**
   ```bash
   git clone https://github.com/7-ZPUs/PoC-DIPReader.git
   cd PoC-DIPReader/DipReader
   ```

2. **Installazione dipendenze**
   ```bash
   npm run setup
   ```

4. **Avvio**
   ```bash
   npm run dev
   ```

---


### Personalizzazione Deploy

Per modificare le piattaforme di output, modifica `package.json`:

```json
"linux": {
  "target": "AppImage"
},
"win": {
  "target": "portable"
},
"mac": {
  "target": "dmg"
}
```