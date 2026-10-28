// Copia la librería de reconocimiento facial (Human), sus modelos y las fuentes a la carpeta public/.
// Netlify lo ejecuta solo al publicar (comando "npm run preparar").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(raiz, 'node_modules');
const pub = path.join(raiz, 'public');

function copiar(origen, destino) {
  if (!fs.existsSync(origen)) {
    console.error(`No se encontró ${origen}. Ejecuta primero: npm install`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origen, destino);
}

// Librería Human (solo la versión para navegador)
copiar(path.join(nm, '@vladmandic/human/dist/human.esm.js'), path.join(pub, 'human/dist/human.esm.js'));

// Solo los modelos que usa el sistema
const modelos = ['blazeface', 'facemesh', 'iris', 'faceres', 'antispoof', 'liveness'];
for (const m of modelos) {
  for (const ext of ['json', 'bin']) {
    copiar(path.join(nm, `@vladmandic/human/models/${m}.${ext}`), path.join(pub, `human/models/${m}.${ext}`));
  }
}

// Fuentes
const fuentes = [
  ['big-shoulders-display', 'big-shoulders-display-latin-600-normal.woff2'],
  ['big-shoulders-display', 'big-shoulders-display-latin-800-normal.woff2'],
  ['atkinson-hyperlegible', 'atkinson-hyperlegible-latin-400-normal.woff2'],
  ['atkinson-hyperlegible', 'atkinson-hyperlegible-latin-700-normal.woff2'],
];
for (const [paquete, archivo] of fuentes) {
  copiar(path.join(nm, '@fontsource', paquete, 'files', archivo), path.join(pub, 'fuentes', paquete, 'files', archivo));
}

console.log('✔ Archivos de reconocimiento facial y fuentes copiados a public/');
