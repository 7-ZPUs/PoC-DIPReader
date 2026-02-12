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
| **TypeScript** | 5.9.2 | Linguaggio di programmazione |

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
   npm install
   ```

   > **Nota**: L'installazione potrebbe richiedere alcuni minuti per compilare i moduli nativi (better-sqlite3)

3. **Rebuild moduli nativi per Electron**
   ```bash
   npm run electron:rebuild
   # oppure manualmente:
   npx electron-rebuild
   ```

4. **Verifica installazione**
   ```bash
   # Build del progetto Angular
   npm run ng build
   
   # Avvio applicazione Electron
   npm run electron
   ```

---
## Development server

### Modalità Development (solo Angular)

Per sviluppare solo la parte Angular in modalità web (senza Electron):

```bash
ng serve
```

Apri il browser su `http://localhost:4200/`. L'applicazione si ricaricherà automaticamente ad ogni modifica.

> **Attenzione**: In questa modalità le API Electron non saranno disponibili.

### Modalità Electron Development

Per sviluppare con Electron (modalità consigliata):

```bash
npm run electron
```

Questo comando:
1. Compila il progetto Angular
2. Avvia l'applicazione Electron con live reload

### Watch Mode

Per ricompilare automaticamente ad ogni modifica (senza avviare Electron):

```bash
npm run watch
```

---

## Building

### Development Build

```bash
ng build
```

I file compilati saranno in `dist/DipReader/browser/`.

### Production Build

```bash
ng build --configuration production --base-href /
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
1. Compila Angular in modalità production
2. Crea pacchetti installabili per il sistema operativo corrente

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
- Applicazione Angular compilata
- Main process Electron (`main.js`, `preload.js`)
- Database handlers (`db-handler.js`, `indexer-main.js`, `ai-search.js`)
- Schema database (`public/schema.sql`)
- Modelli AI pre-scaricati (`assets/models/`)
- Runtime ONNX WebAssembly (`assets/onnx-wasm/`)

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
rm -rf node_modules package-lock.json
npm install
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
npm run electron:ubuntu
```


---


## Scripts Disponibili

| Script | Descrizione |
|--------|-------------|
| `npm run ng` | CLI Angular |
| `npm run watch` | Build Angular in watch mode |
| `npm test` | Esegui unit test con Vitest |
| `npm run electron` | Build + avvia Electron (development) |
| `npm run dist` | Build production + crea pacchetti installabili |
