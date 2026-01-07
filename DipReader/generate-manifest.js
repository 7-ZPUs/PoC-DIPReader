const fs = require('fs');
const path = require('path');

// Definisci il percorso della cartella pubblica
const publicDir = path.join(__dirname, 'public');
const manifestPath = path.join(publicDir, 'package-manifest.json');

try {
    // Controlla esplicitamente se la cartella 'public' esiste prima di procedere.
    if (!fs.existsSync(publicDir)) {
        throw new Error(`La cartella 'public' non è stata trovata. Assicurati che esista nella root del progetto ('${__dirname}') e che contenga i file del pacchetto DIP.`);
    }

    // Leggi tutti i file nella cartella pubblica
    const files = fs.readdirSync(publicDir);

    // Trova i file che corrispondono al pattern
    const dipIndexFiles = files.filter(file => /^DiPIndex\..*\.xml$/.test(file));

    if (dipIndexFiles.length === 0) {
        throw new Error(`Nessun file DiPIndex.*.xml trovato nella cartella '${publicDir}'. Assicurati che esista una cartella 'public' nella root del progetto.`);
    }

    if (dipIndexFiles.length > 1) {
        console.warn(`ATTENZIONE: Trovati ${dipIndexFiles.length} file DiPIndex.*.xml. Verrà utilizzato il primo: ${dipIndexFiles[0]}`);
    }

    const indexFile = dipIndexFiles[0];
    const manifestContent = { indexFile };

    // Scrivi il file manifest in formato JSON
    fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2));

    console.log(`✅ File manifest '${manifestPath}' creato/aggiornato con successo. Indice: ${indexFile}`);
} catch (error) {
    console.error(`❌ Errore durante la generazione del file manifest: ${error.message}`);
    process.exit(1); // Esce con un codice di errore per bloccare build fallate
}