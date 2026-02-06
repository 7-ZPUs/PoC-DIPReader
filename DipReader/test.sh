#!/bin/bash

# ============================================================================
# Script di Verifica Pre-Build per DipReader
# ============================================================================
# Controlla che tutti i file richiesti siano presenti e nella posizione corretta
# Esegui con: bash verify-setup.sh

echo "🔍 Verifica Configurazione DipReader"
echo "===================================="
echo ""

ERRORS=0
WARNINGS=0

# ============================================================================
# 1. Verifica SQLite WASM
# ============================================================================
echo "📦 Controllo SQLite WASM..."

SQLITE_PATH="node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm"
REQUIRED_FILES=(
    "sqlite3.wasm"
    "sqlite3.js"
    "sqlite3-opfs-async-proxy.js"
)

if [ ! -d "$SQLITE_PATH" ]; then
    echo "❌ ERRORE: Cartella SQLite non trovata!"
    echo "   Path: $SQLITE_PATH"
    echo "   Fix: npm install @sqlite.org/sqlite-wasm"
    ((ERRORS++))
else
    echo "✅ Cartella SQLite trovata"
    
    for file in "${REQUIRED_FILES[@]}"; do
        if [ -f "$SQLITE_PATH/$file" ]; then
            SIZE=$(du -h "$SQLITE_PATH/$file" | cut -f1)
            echo "   ✓ $file ($SIZE)"
        else
            echo "   ❌ MANCA: $file"
            ((ERRORS++))
        fi
    done
fi

echo ""

# ============================================================================
# 2. Verifica Modello AI
# ============================================================================
echo "🤖 Controllo Modello Transformers.js..."

# Cerca il modello (potrebbe essere in path diversi)
MODEL_PATHS=(
    "src/assets/models/Xenova/all-MiniLM-L6-v2"
    "src/assets/models/nomic-ai/v1.5-fixed"
    "src/assets/models/Xenova/nomic-embed-text-v1.5"
)

FOUND_MODEL=false
ACTUAL_MODEL_PATH=""

for path in "${MODEL_PATHS[@]}"; do
    if [ -d "$path" ]; then
        FOUND_MODEL=true
        ACTUAL_MODEL_PATH="$path"
        echo "✅ Modello trovato in: $path"
        break
    fi
done

if [ "$FOUND_MODEL" = false ]; then
    echo "❌ ERRORE: Nessun modello AI trovato!"
    echo "   Percorsi cercati:"
    for path in "${MODEL_PATHS[@]}"; do
        echo "     - $path"
    done
    echo ""
    echo "   Fix: Scarica il modello da Hugging Face e posizionalo in src/assets/models/"
    ((ERRORS++))
else
    # Verifica file del modello
    REQUIRED_MODEL_FILES=(
        "config.json"
        "tokenizer_config.json"
        "tokenizer.json"
        "model_quantized.onnx"
    )
    
    echo "   Verifica file del modello:"
    for file in "${REQUIRED_MODEL_FILES[@]}"; do
        if [ -f "$ACTUAL_MODEL_PATH/$file" ]; then
            SIZE=$(du -h "$ACTUAL_MODEL_PATH/$file" | cut -f1)
            echo "   ✓ $file ($SIZE)"
        else
            echo "   ❌ MANCA: $file"
            ((ERRORS++))
        fi
    done
    
    # Controlla dimensione .onnx (dovrebbe essere ~23MB)
    if [ -f "$ACTUAL_MODEL_PATH/model_quantized.onnx" ]; then
        SIZE_BYTES=$(stat -f%z "$ACTUAL_MODEL_PATH/model_quantized.onnx" 2>/dev/null || stat -c%s "$ACTUAL_MODEL_PATH/model_quantized.onnx" 2>/dev/null)
        if [ ! -z "$SIZE_BYTES" ]; then
            if [ "$SIZE_BYTES" -lt 1000000 ]; then
                echo "   ⚠️  ATTENZIONE: model_quantized.onnx sembra troppo piccolo ($(du -h "$ACTUAL_MODEL_PATH/model_quantized.onnx" | cut -f1))"
                echo "      Dimensione attesa: ~23MB"
                ((WARNINGS++))
            fi
        fi
    fi
fi

echo ""

# ============================================================================
# 3. Verifica Configurazione Angular
# ============================================================================
echo "⚙️  Controllo angular.json..."

if [ ! -f "angular.json" ]; then
    echo "❌ ERRORE: angular.json non trovato!"
    ((ERRORS++))
else
    # Controlla se il path di output per SQLite è corretto
    if grep -q '"output": "/sqlite-wasm"' angular.json; then
        echo "✅ Path output SQLite corretto (/sqlite-wasm)"
    else
        if grep -q '"output": "/"' angular.json; then
            echo "⚠️  ATTENZIONE: SQLite usa output '/' invece di '/sqlite-wasm'"
            echo "   Questo può causare conflitti con il routing Angular"
            ((WARNINGS++))
        else
            echo "❌ Configurazione SQLite non trovata in angular.json"
            ((ERRORS++))
        fi
    fi
fi

echo ""

# ============================================================================
# 4. Verifica Workers
# ============================================================================
echo "👷 Controllo Web Workers..."

WORKERS=(
    "src/app/db.worker.ts"
    "src/app/sqlite-db.worker.ts"
)

for worker in "${WORKERS[@]}"; do
    if [ -f "$worker" ]; then
        echo "✅ Worker trovato: $worker"
        
        # Controlla se db.worker.ts ha locateFile
        if [[ "$worker" == *"db.worker.ts" ]]; then
            if grep -q "locateFile" "$worker"; then
                echo "   ✓ Callback locateFile presente"
            else
                echo "   ⚠️  ATTENZIONE: Manca callback locateFile per SQLite"
                echo "      Questo causerà errori OPFS"
                ((WARNINGS++))
            fi
        fi
    else
        echo "❌ Worker mancante: $worker"
        ((ERRORS++))
    fi
done

echo ""

# ============================================================================
# 5. Riepilogo
# ============================================================================
echo "========================================"
echo "📊 Riepilogo Verifica"
echo "========================================"
echo "Errori critici: $ERRORS"
echo "Avvisi: $WARNINGS"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "✅ Configurazione PERFETTA!"
    echo "   Puoi procedere con: ng serve"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo "⚠️  Configurazione BUONA con avvisi"
    echo "   L'app dovrebbe funzionare ma ci sono miglioramenti possibili"
    exit 0
else
    echo "❌ Configurazione INCOMPLETA"
    echo "   Risolvi gli errori prima di compilare"
    echo ""
    echo "💡 Consulta TROUBLESHOOTING_GUIDE.md per istruzioni dettagliate"
    exit 1
fi