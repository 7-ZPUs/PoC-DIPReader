# Modelli AI ONNX

Questa cartella contiene i modelli ONNX pre-addestrati utilizzati per ricerca semantica e embeddings.

## Configurazione

### Per la prima volta (setup iniziale)

Dopo aver clonato il repository, esegui il comando di setup che installa le dipendenze e scarica i modelli:

```bash
npm run setup
```

Questo comando:
1. Installa tutte le dipendenze npm
2. Scarica i modelli ONNX quantizzati da Hugging Face

### Per scaricare solo i modelli

Se hai già npm installato e vuoi solo scaricare i modelli:

```bash
npm run setup:models
```

## Modelli disponibili

### paraphrase-multilingual-MiniLM-L12-v2

- **Utilizzo**: Generazione di embedding per ricerca semantica multilingue
- **Dimensione embedding**: 384
- **Dimensione file**: ~100-150 MB (quantizzato)
- **Fonte**: [Xenova/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)

### all-MiniLM-L6-v2

- **Utilizzo**: Generazione di embedding generale
- **Dimensione embedding**: 384
- **Dimensione file**: ~22 MB (quantizzato)
- **Fonte**: [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)

## Nota su GitHub

I file `.onnx` sono ignorati dal versionamento Git (`.gitignore`) poiché sono troppo pesanti. La struttura delle cartelle è preservata con file `.gitkeep` per garantire che la directory esista quando il repository viene clonato.

## Troubleshooting

### I modelli non vengono scaricati

- Verifica la connessione a internet
- Controlla che il progetto sia nella root directory corretta
- Prova ad eseguire di nuovo: `npm run setup:models`

### Errore: "ENOENT: no such file or directory"

Assicurati che la cartella `src/assets/models/Xenova/` esista. Se no, esegui:

```bash
npm run setup:models
```

Lo script creerà la struttura necessaria automaticamente.
