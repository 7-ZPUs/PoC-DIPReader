# DipReader

Proof of Concept del Capitolato C3 - "DIP Reader: Applicazione per la gestione e consultazione di archivi DIP"

---

## Dipendenze

### Tecnologie Principali

| Tecnologia | Versione | Descrizione |
|-----------|----------|-------------|
| **Node.js** | ≥18.0.0 | Runtime JavaScript |
| **npm** | 10.9.3 | Package manager |
| **Angular** | 21.0.0 | Framework frontend |
| **Electron** | 40.2.1 | Framework per app desktop |
| **TypeScript** | 5.9.2 | Linguaggio di programmazione (frontend + backend) |

### Dipendenze Core

| Libreria | Versione | Utilizzo |
|----------|----------|----------|
| `better-sqlite3` | 12.6.2 | Database SQLite nativo |
| `@xenova/transformers` | 2.17.2 | Machine Learning (embeddings) |
| `onnxruntime-web` | 1.24.1 | Runtime per modelli ONNX |
| `fast-xml-parser` | 5.3.3 | Parser XML per metadati DIP |

### Dipendenze di sviluppo

- **Angular CLI**: 20.0.6
- **Electron Builder**: 26.7.0
- **Vitest**: 4.0.8 (test runner)
- **@electron/rebuild**: 4.0.3 (build moduli nativi)
- **@types/node**: 22.10.5 (Type definitions Node.js)
- **@types/better-sqlite3**: 7.6.11 (Type definitions SQLite)
- **@types/xmldom**: 0.1.34 (Type definitions XML parser)

---


### Pipeline di Build

1. **TypeScript Compilation** (`npm run build`)
   - Compila `*.ts` → `dist-main/*.js`
   - Genera type declarations (`*.d.ts`)
   - Crea source maps per debugging

2. **Angular Build** (`npm run build`)
   - Compila frontend TypeScript
   - Output in `dist/DipReader/browser/`

3. **Electron Package** (`npm run dist`)
   - Combina Angular build + main process compilato
   - Crea eseguibili per la piattaforma corrente

---

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

3. **Build tools** (per compilare moduli nativi come better-sqlite3)
   
   **Linux:**
   ```bash
   sudo apt-get install build-essential python3
   ```
   
   **macOS:**
   ```bash
   xcode-select --install
   ```
   
   **Windows:**
   - Installa [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) con "Desktop development with C++"

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

   > **Nota**: L'installazione potrebbe richiedere alcuni minuti per compilare i moduli nativi (better-sqlite3).  
   Questo comando esegue:
   > - Installazione dipendenze npm
   > - Compilazione TypeScript per il download dei modelli
   > - Download modelli quantizzati da HuggingFace (più info nel README.md della cartella src/assets/models)

3. **Rebuild moduli nativi per Electron**
   ```bash
   npm run rebuild
   # oppure manualmente:
   npx electron-rebuild
   ```

4. **Verifica installazione**
   ```bash
   # Build completo (TypeScript + Angular)
   npm run build
   
   # Avvio Electron
   npm start
   
   # Oppure tutto insieme
   npm run dev
   ```

---

### Workflow di Sviluppo

#### Build + Avvio Separati

```bash
# 1. Build completo (TypeScript main process + Angular frontend)
npm run build

# 2. Avvio Electron (senza rebuild)
npm start
```

#### Build + Avvio Insieme (rapido)

```bash
# Build + avvio in un comando
npm run dev

# Su Ubuntu con problemi GPU:
npm run dev:ubuntu
```

I file compilati saranno in:
- Main process: `dist-main/` (JS + declaration files + source maps)
- Frontend: `dist/DipReader/browser/`

### Production Build

```bash
# Build production + pacchetto installabile
npm run dist

# Solo build production (senza packaging)
npm run build:prod
```

Build ottimizzata per performance e dimensioni.

---

## Deployment

### Build Applicazione Desktop

#### 1. Build completo con Electron Builder

```bash
npm run dist
```

Questo comando:
1. Compila TypeScript del main process (da `.ts` a `.js`)
2. Compila Angular in modalità production
3. Crea pacchetti installabili per il sistema operativo corrente

#### 2. Output della Build

I file generati si trovano in `dist-electron/`:

**Linux:**
- `DipReader-<version>.AppImage` - Formato AppImage portabile

**Windows:**
- `DipReader-<version>.exe` - Eseguibile portable

**macOS:**
- `DipReader-<version>.dmg` - Installer DMG

#### 3. Build Multi-Piattaforma

Per creare pacchetti per tutte le piattaforme (richiede Docker o macchine virtuali):

```bash
# Linux + Windows (da Linux)
npm run dist -- --linux --win

# Tutte le piattaforme (da macOS)
npm run dist -- --mac --linux --win
```

### Configurazione Build

La configurazione è definita in `package.json` sotto la chiave `build`:

```json
{
  "build": {
    "appId": "com.dipreader.app",
    "productName": "DipReader",
    "linux": {
      "target": "AppImage",
      "category": "Utility"
    },
    "win": {
      "target": "portable"
    }
  }
}
```

### Personalizzazione Build

Per modificare le piattaforme di output, modifica `package.json`:

```json
"linux": {
  "target": ["AppImage", "deb", "rpm"]
},
"win": {
  "target": ["portable", "nsis", "msi"]
},
"mac": {
  "target": ["dmg", "zip"]
}
```

### Asset Inclusi nel Package

I seguenti file sono automaticamente inclusi nella build:
- Applicazione Angular compilata (`dist/DipReader/browser/`)
- Main process Electron compilato da TypeScript (`dist-main/*.js`)
  - `main.js` - Entry point Electron
  - `preload.js` - IPC bridge
  - `db-handler.js` - SQLite + vector search
  - `indexer-main.js` - XML parser e indexer
  - `ai-search.js` - Semantic search con transformers
  - `download-models.js` - Script download modelli
- Schema database (`schema.sql`)
- Modelli AI pre-scaricati (`assets/models/`)

---

## Troubleshooting

### Errore: "better-sqlite3" non compilato correttamente

```bash
# Rebuild dei moduli nativi per Electron
npx electron-rebuild -f -w better-sqlite3
```

### Errore: "Module not found" o dipendenze mancanti

```bash
# Pulisci cache e reinstalla
rm -rf node_modules package-lock.json dist dist-main
npm install
npm run build
```

### Errore durante la build per Linux

Assicurati di avere installato i pacchetti necessari:

```bash
sudo apt-get install -y build-essential python3 rpm
```

### L'applicazione non si avvia dopo la build

Verifica che tutti gli asset siano inclusi:

```bash
# Controlla il contenuto del pacchetto
unzip -l dist-electron/DipReader-*.AppImage  # Linux
# oppure apri manualmente il file .exe/.dmg
```

### Errore all'accelerazione hardware "Schema ... does not have key font-antialiasing"

```bash
# Build + avvio con GPU disabled
npm run dev:ubuntu

# Oppure solo avvio (dopo build)
npm run start:ubuntu
```

### Errore di compilazione TypeScript

Se la compilazione TypeScript fallisce:

```bash
# Verifica errori TypeScript
npm run build

# Se ci sono errori nei file .ts, correggili prima di procedere
# I file sorgente sono nella root: main.ts, db-handler.ts, etc.

# Pulisci e ricompila
rm -rf dist-main
npm run build
```

### I file JavaScript non sono aggiornati

Se modifichi i file `.ts` ma Electron usa codice vecchio:

```bash
# Assicurati di compilare prima di avviare
npm run dev

# Verifica che dist-main/ contenga i file aggiornati
ls -la dist-main/
```

---


## Scripts Disponibili

### Setup Iniziale
| Script | Descrizione |
|--------|-------------|
| `npm run setup` | Installa dipendenze + scarica modelli AI |
| `npm run setup:models` | Solo download modelli AI |
| `npm run rebuild` | Rebuild moduli nativi (better-sqlite3, onnxruntime) |

### Sviluppo
| Script | Descrizione |
|--------|-------------|
| `npm run build` | Build completo (TypeScript + Angular) |
| `npm start` | Avvia Electron (dopo build) |
| `npm run dev` | Build + avvio insieme |
| `npm run dev:ubuntu` | Build + avvio (Ubuntu, GPU disabled) |
| `npm run dev:ubuntu-x11` | Build + avvio (Ubuntu, backend X11) |
| `npm run start:ubuntu` | Solo avvio (Ubuntu, GPU disabled) |
| `npm run start:ubuntu-x11` | Solo avvio (Ubuntu, backend X11) |

### Production
| Script | Descrizione |
|--------|-------------|
| `npm run build:prod` | Build production ottimizzato |
| `npm run dist` | Build production + crea pacchetti installabili |

### Utility
| Script | Descrizione |
|--------|-------------|
| `npm run clean` | Rimuove tutti i file compilati |
