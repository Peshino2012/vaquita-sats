// Servidor estático para desarrollo y tests: `npm start` (y con --relay,
// también levanta un relay Nostr local en ws://127.0.0.1:7777).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarRelay } from './relay.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PUERTO = Number(process.env.PORT) || 4173;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = normalize(join(RAIZ, ruta));
  if (!archivo.startsWith(RAIZ) || /node_modules|\/\./.test(archivo.slice(RAIZ.length))) {
    res.writeHead(403).end();
    return;
  }
  try {
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(cuerpo);
  } catch {
    res.writeHead(404).end('no encontrado');
  }
}).listen(PUERTO, '127.0.0.1', () => console.log(`Vaquita en http://127.0.0.1:${PUERTO}/`));

if (process.argv.includes('--relay')) {
  iniciarRelay();
  console.log('Relay de prueba en ws://127.0.0.1:7777');
}
