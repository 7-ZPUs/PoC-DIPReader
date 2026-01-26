const fs = require('fs');
const path = require('path');

// Definisci il percorso della cartella pubblica
const publicDir = path.join(__dirname, 'public');
const manifestPath = path.join(publicDir, 'package-manifest.json');

// 1. Assicurati che la cartella public esista
if (!fs.existsSync(publicDir)) {
    console.log(`Cartella 'public' non trovata. Creazione in corso...`);
    fs.mkdirSync(publicDir, { recursive: true });
}

try {
    // --- GESTIONE MANIFEST ---
    const files = fs.readdirSync(publicDir);
    const dipIndexFiles = files.filter(file => /^DiPIndex\..*\.xml$/.test(file));

    if (dipIndexFiles.length === 0) {
        // Non blocchiamo lo script se manca l'XML, ma creiamo un manifest vuoto per evitare errori nel frontend
        console.warn(`⚠️  ATTENZIONE: Nessun file DiPIndex.*.xml trovato in '${publicDir}'.`);
        console.warn(`   L'applicazione partirà, ma non vedrai nessun documento finché non aggiungi il file XML.`);
        fs.writeFileSync(manifestPath, JSON.stringify({ indexFile: null }, null, 2));
    } else {
        if (dipIndexFiles.length > 1) {
            console.warn(`ATTENZIONE: Trovati ${dipIndexFiles.length} file DiPIndex.*.xml. Verrà utilizzato il primo: ${dipIndexFiles[0]}`);
        }

        const indexFile = dipIndexFiles[0];
        const manifestContent = { indexFile };
        fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2));
        console.log(`✅ File manifest creato: ${indexFile}`);
    }

    // --- GESTIONE SQLITE WASM ---
    // Cerchiamo il file in più percorsi possibili per robustezza
    // --- GESTIONE SQLITE (CUSTOM BUILD) ---
    // Usiamo la versione custom che include già sqlite-vec al suo interno
    const sourceWasm = path.join(__dirname, 'wasm-source', 'sqlite3.wasm');
    const sourceJs = path.join(__dirname, 'wasm-source', 'sqlite3.mjs');
    
    const destWasm = path.join(publicDir, 'sqlite3.wasm');
    const destJs = path.join(publicDir, 'sqlite3.mjs');

    if (fs.existsSync(sourceWasm) && fs.existsSync(sourceJs)) {
        fs.copyFileSync(sourceWasm, destWasm);
        fs.copyFileSync(sourceJs, destJs);
        console.log(`✅ Core SQLite+Vec copiato in 'public' da 'wasm-source'`);
    } else {
        console.error(`❌ ERRORE: File sqlite3.wasm o sqlite3.mjs mancanti in 'wasm-source'.`);
        console.error(`   Scaricali da: https://cdn.jsdelivr.net/npm/sqlite-vec-wasm-demo@latest/`);
        process.exit(1);
    }
    
    // --- NOTA: Non serve più copiare vec0.wasm separatamente perché è incluso in sqlite3.wasm! ---
} catch (error) {
    console.error(`❌ Errore durante la generazione del file manifest: ${error.message}`);
    process.exit(1); // Esce con un codice di errore per bloccare build fallate
}