import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

// Configurazione Percorsi
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// NOTA BENE: Usiamo il repo di Xenova che ha i file ONNX già pronti
const repo = 'Xenova/nomic-embed-text-v1.5'; 
const branch = 'main';
// Salviamo comunque in una cartella con il nome "nomic-ai" per coerenza o cambiamo path
const baseDir = path.join(__dirname, 'src/assets/models/nomic-ai/nomic-embed-text-v1.5');

const filesToDownload = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'model_quantized.onnx' // <--- QUESTO è il file fondamentale che mancava!
];

console.log(`🚀 Avvio download manuale in: ${baseDir}`);

if (!fs.existsSync(baseDir)){
    fs.mkdirSync(baseDir, { recursive: true });
}

const downloadFile = (filename) => {
    const url = `https://huggingface.co/${repo}/resolve/${branch}/${filename}`;
    const dest = path.join(baseDir, filename);
    const file = fs.createWriteStream(dest);

    console.log(`⬇️  Scaricando: ${filename}...`);

    https.get(url, (response) => {
        if (response.statusCode !== 200) {
            console.error(`❌ Errore scaricando ${filename}: HTTP ${response.statusCode}`);
            return;
        }
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            console.log(`✅ Completato: ${filename}`);
        });
    }).on('error', (err) => {
        fs.unlink(dest, () => {}); // Elimina file parziale
        console.error(`❌ Errore di rete: ${err.message}`);
    });
};

// Esegui il download
filesToDownload.forEach(file => downloadFile(file));