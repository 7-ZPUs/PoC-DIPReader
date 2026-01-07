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
    const possibleWasmPaths = [
        // Percorso standard npm
        path.join(__dirname, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'jswasm', 'sqlite3.wasm'),
        // Percorso standard per versioni recenti (es. 3.51.1)
        path.join(__dirname, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'sqlite-wasm', 'jswasm', 'sqlite3.wasm'),
        // Percorso alternativo/vecchio
        path.join(__dirname, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist', 'sqlite3.wasm')
    ];

    const sourceWasm = possibleWasmPaths.find(p => fs.existsSync(p));
    const destWasm = path.join(publicDir, 'sqlite3.wasm');
    
    if (sourceWasm) {
        fs.copyFileSync(sourceWasm, destWasm);
        console.log(`✅ File 'sqlite3.wasm' copiato in 'public' da: ${sourceWasm}`);

        // NUOVO: Copia anche il file JS (ES Module) per caricarlo dinamicamente
        // Assumiamo che il file JS si trovi nella stessa cartella del WASM e si chiami 'sqlite3.mjs'
        const sourceJs = path.join(path.dirname(sourceWasm), 'sqlite3.mjs');
        const destJs = path.join(publicDir, 'sqlite3.mjs');
        
        if (fs.existsSync(sourceJs)) {
            fs.copyFileSync(sourceJs, destJs);
            console.log(`✅ File 'sqlite3.mjs' copiato in 'public'`);
        } else {
            console.warn(`⚠️  ATTENZIONE: File 'sqlite3.mjs' non trovato in '${path.dirname(sourceWasm)}'.`);
        }
    } else {
        console.error(`❌ ERRORE CRITICO: Impossibile trovare 'sqlite3.wasm'.`);
        console.error(`   Ho cercato in:`);
        possibleWasmPaths.forEach(p => console.error(`   - ${p}`));
        console.error(`   Esegui 'npm install' per ripristinare le dipendenze.`);
        process.exit(1);
    }
} catch (error) {
    console.error(`❌ Errore durante la generazione del file manifest: ${error.message}`);
    process.exit(1); // Esce con un codice di errore per bloccare build fallate
}