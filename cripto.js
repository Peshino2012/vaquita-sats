// Cifrado de la vaquita con AES-256-GCM (WebCrypto). La clave viaja solo en
// el fragmento del link (#k=...), que el navegador nunca manda a un servidor:
// los relays guardan el contenido cifrado y no ven nombres ni montos en pesos.

const AAD = new TextEncoder().encode('vaquita:v1');
const PREFIJO = 'v1:';

export function aBase64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deBase64url(texto) {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texto.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Clave nueva de 256 bits, en base64url (43 caracteres). */
export function nuevaClave() {
  return aBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

function importar(clave) {
  const bytes = deBase64url(clave);
  if (bytes.length !== 32) throw new Error('Clave inválida');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function cifrar(objeto, clave) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = new TextEncoder().encode(JSON.stringify(objeto));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await importar(clave), datos));
  const todo = new Uint8Array(iv.length + ct.length);
  todo.set(iv);
  todo.set(ct, iv.length);
  return PREFIJO + aBase64url(todo);
}

/** Descifra y parsea. Tira error si la clave no corresponde o el contenido fue alterado. */
export async function descifrar(texto, clave) {
  if (typeof texto !== 'string' || !texto.startsWith(PREFIJO)) throw new Error('Formato desconocido');
  const todo = deBase64url(texto.slice(PREFIJO.length));
  const iv = todo.slice(0, 12);
  const ct = todo.slice(12);
  const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await importar(clave), ct);
  return JSON.parse(new TextDecoder().decode(plano));
}
