// QR como SVG armado con el DOM (sin innerHTML). Las facturas Lightning van en
// mayúsculas para usar el modo alfanumérico del QR, que es más denso.
import qrcode from './vendor/qrcode.js';

const ALFANUMERICO = /^[0-9A-Z $%*+\-./:]*$/;
const NS = 'http://www.w3.org/2000/svg';

export function svgQR(texto, { margen = 2, etiqueta = 'Código QR' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(texto, ALFANUMERICO.test(texto) ? 'Alphanumeric' : 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + margen} ${y + margen}h1v1h-1z`;
  }
  const lado = n + margen * 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${lado} ${lado}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', etiqueta);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const fondo = document.createElementNS(NS, 'rect');
  fondo.setAttribute('width', lado);
  fondo.setAttribute('height', lado);
  fondo.setAttribute('fill', '#fff');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(fondo, path);
  return svg;
}
