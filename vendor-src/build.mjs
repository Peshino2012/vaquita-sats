// Genera vendor/*.js: módulos ES autocontenidos, sin CDN, para que la app
// funcione como sitio estático (GitHub Pages) y sin paso de build en runtime.
import { build } from 'esbuild';

const comunes = { bundle: true, format: 'esm', minify: true, target: 'es2022', legalComments: 'inline', logLevel: 'info' };
await build({ ...comunes, entryPoints: ['vendor-src/nostr.js'], outfile: 'vendor/nostr.js' });
await build({ ...comunes, entryPoints: ['vendor-src/qrcode.js'], outfile: 'vendor/qrcode.js' });
