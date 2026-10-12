// Nostr: la vaquita es un evento direccionable (kind 30078, NIP-78) firmado
// por una clave propia de esa vaquita, con el contenido cifrado. Los aportes
// son recibos de zap (kind 9735) que publica la billetera de quien organiza.
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip19, bytesToHex, hexToBytes } from './vendor/nostr.js';

export const KIND_VAQUITA = 30078;
export const RELAYS = ['wss://relay.lacrypta.ar', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

let pool = null;
const getPool = () => (pool ??= new SimplePool({ enablePing: true, enableReconnect: true }));

export function nuevaIdentidad() {
  const sk = generateSecretKey();
  return { sk: bytesToHex(sk), pk: getPublicKey(sk) };
}

export const pubkeyDe = (skHex) => getPublicKey(hexToBytes(skHex));
export const firmar = (plantilla, skHex) => finalizeEvent(plantilla, hexToBytes(skHex));
export const coordenada = (pubkey, d) => `${KIND_VAQUITA}:${pubkey}:${d}`;

export const codificarNaddr = ({ pubkey, d, relays }) => nip19.naddrEncode({ kind: KIND_VAQUITA, pubkey, identifier: d, relays: relays.slice(0, 3) });

export function decodificarNaddr(naddr) {
  const { type, data } = nip19.decode(naddr);
  if (type !== 'naddr' || data.kind !== KIND_VAQUITA || !/^[0-9a-f]{64}$/.test(data.pubkey)) throw new Error('Link inválido');
  return { pubkey: data.pubkey, d: data.identifier, relays: data.relays || [] };
}

export const linkComprobante = (id, relays) => `https://njump.me/${nip19.neventEncode({ id, relays: relays.slice(0, 2) })}`;

/** Publica en todos los relays; alcanza con que uno lo acepte. */
export async function publicar(evento, relays) {
  const resultados = await Promise.allSettled(getPool().publish(relays, evento, { maxWait: 8000 }));
  const aceptados = resultados.filter((r) => r.status === 'fulfilled').length;
  if (!aceptados) throw new Error('Ningún relay aceptó el evento. Revisá tu conexión y probá de nuevo.');
  return aceptados;
}

/** Firma y publica una versión nueva de la vaquita (reemplaza a la anterior). */
export async function publicarVaquita({ sk, d, contenido, relays, anterior = 0 }) {
  const created_at = Math.max(Math.floor(Date.now() / 1000), anterior + 1);
  const evento = firmar(
    {
      kind: KIND_VAQUITA,
      created_at,
      tags: [
        ['d', d],
        ['alt', 'Vaquita: gastos compartidos en sats (contenido cifrado)'],
      ],
      content: contenido,
    },
    sk,
  );
  await publicar(evento, relays);
  return evento;
}

/** Escucha recibos de zap dirigidos a una clave desde un momento dado (propinas). */
export function escucharRecibos({ pubkey, relays, desde, onRecibo }) {
  const s = getPool().subscribeMany(relays, { kinds: [9735], '#p': [pubkey], since: desde }, { onevent: onRecibo });
  return () => s.close();
}

/** Escucha la vaquita (y sus ediciones) y los recibos de zap dirigidos a ella. */
export function escuchar({ pubkey, d, relays, onVaquita, onRecibo, onListo }) {
  let pendientes = 2;
  const listo = () => {
    if (--pendientes === 0) onListo?.();
  };
  const a = getPool().subscribeMany(relays, { kinds: [KIND_VAQUITA], authors: [pubkey], '#d': [d] }, { onevent: onVaquita, oneose: listo });
  const b = getPool().subscribeMany(relays, { kinds: [9735], '#p': [pubkey] }, { onevent: onRecibo, oneose: listo });
  return () => {
    a.close();
    b.close();
  };
}
