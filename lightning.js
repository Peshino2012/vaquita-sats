// Lightning: resolver una Lightning Address (LUD-16/LUD-06), pedir una
// factura con un pedido de zap (NIP-57) y validar los comprobantes de pago
// (recibos de zap, kind 9735) según el Apéndice F de NIP-57.
import { bech32, verifyEvent, getSatoshisAmountFromBolt11 } from './vendor/nostr.js';

export class ErrorLightning extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export function urlLnurlp(direccion) {
  const [usuario, dominio] = direccion.trim().toLowerCase().split('@');
  return `https://${dominio}/.well-known/lnurlp/${encodeURIComponent(usuario)}`;
}

export function codificarLnurl(url) {
  return bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), 1023);
}

async function pedirJson(url, fetchImpl, mensajeRed) {
  let r;
  try {
    r = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new ErrorLightning('red', mensajeRed);
  }
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { ok: r.ok, j };
}

/**
 * Consulta la Lightning Address y devuelve lo necesario para cobrar con zaps.
 * Tira ErrorLightning con un mensaje listo para mostrar.
 */
export async function resolverDireccion(direccion, fetchImpl = fetch) {
  const url = urlLnurlp(direccion);
  const { ok, j } = await pedirJson(url, fetchImpl, 'No pudimos contactar a la billetera. Revisá la dirección y tu conexión.');
  if (!ok || !j || j.status === 'ERROR' || j.tag !== 'payRequest') {
    throw new ErrorLightning('no-existe', 'Esa Lightning Address no existe o la billetera no respondió bien.');
  }
  let callback;
  try {
    callback = new URL(j.callback);
  } catch {}
  if (!callback || callback.protocol !== 'https:') throw new ErrorLightning('invalida', 'La billetera devolvió una configuración inválida.');
  const allowsNostr = j.allowsNostr === true && /^[0-9a-f]{64}$/.test(j.nostrPubkey || '');
  return {
    direccion: direccion.trim().toLowerCase(),
    callback: callback.toString(),
    minSendable: Number(j.minSendable) || 1000,
    maxSendable: Number(j.maxSendable) || 1e11,
    commentAllowed: Number(j.commentAllowed) || 0,
    allowsNostr,
    nostrPubkey: allowsNostr ? j.nostrPubkey : null,
    lnurl: codificarLnurl(url),
  };
}

/** Pedido de zap (kind 9734, sin firmar) para pagar la parte de una persona. */
export function armarPedidoZap({ info, vaquitaPk, coordenada, eventoId, persona, sats, relays, ahora = Date.now() }) {
  const tags = [
    ['relays', ...relays],
    ['amount', String(sats * 1000)],
    ['lnurl', info.lnurl],
    ['p', vaquitaPk],
    ['a', coordenada],
  ];
  if (eventoId) tags.push(['e', eventoId]);
  tags.push(['vaquita', persona]);
  const comentario = 'Aporte a la vaquita';
  return { kind: 9734, created_at: Math.floor(ahora / 1000), tags, content: info.commentAllowed >= comentario.length ? comentario : '' };
}

/** Pide la factura al callback LNURL con el pedido de zap firmado. */
export async function pedirFactura({ info, sats, pedido, fetchImpl = fetch }) {
  const msat = sats * 1000;
  if (msat < info.minSendable || msat > info.maxSendable) {
    const min = Math.ceil(info.minSendable / 1000);
    const max = Math.floor(info.maxSendable / 1000);
    throw new ErrorLightning('monto', `La billetera de quien organiza acepta pagos de ${min} a ${max} sats.`);
  }
  const url = new URL(info.callback);
  url.searchParams.set('amount', String(msat));
  url.searchParams.set('nostr', JSON.stringify(pedido));
  url.searchParams.set('lnurl', info.lnurl);
  const { j } = await pedirJson(url.toString(), fetchImpl, 'No pudimos pedir la factura. Revisá tu conexión y probá de nuevo.');
  if (!j || j.status === 'ERROR' || typeof j.pr !== 'string') {
    const motivo = j && typeof j.reason === 'string' ? `: ${j.reason.slice(0, 140)}` : '.';
    throw new ErrorLightning('factura', `La billetera no generó la factura${motivo}`);
  }
  const pr = j.pr.trim().toLowerCase();
  if (!pr.startsWith('lnbc')) throw new ErrorLightning('factura', 'La factura no es de la red principal de Bitcoin.');
  if (getSatoshisAmountFromBolt11(pr) !== sats) throw new ErrorLightning('factura', 'La factura no coincide con el monto pedido.');
  return { pr, verify: typeof j.verify === 'string' ? j.verify : null };
}

const tag = (evento, nombre) => evento.tags.find((t) => t[0] === nombre)?.[1];

/**
 * Valida un recibo de zap (kind 9735). Devuelve el aporte o null si no es
 * válido. Un recibo solo cuenta si lo firmó el servidor LNURL de quien
 * organiza (nostrPubkey), el pedido embebido está firmado y apunta a esta
 * vaquita, y los montos del pedido y de la factura coinciden.
 */
export function validarRecibo(recibo, { nostrPubkey, vaquitaPk }) {
  try {
    if (!recibo || recibo.kind !== 9735 || recibo.pubkey !== nostrPubkey) return null;
    if (!verifyEvent(recibo)) return null;
    const bolt11 = tag(recibo, 'bolt11');
    const descripcion = tag(recibo, 'description');
    if (!bolt11 || !descripcion || tag(recibo, 'p') !== vaquitaPk) return null;
    const pedido = JSON.parse(descripcion);
    if (!pedido || pedido.kind !== 9734 || !Array.isArray(pedido.tags) || !verifyEvent(pedido)) return null;
    const ps = pedido.tags.filter((t) => t[0] === 'p');
    if (ps.length !== 1 || ps[0][1] !== vaquitaPk) return null;
    const sats = getSatoshisAmountFromBolt11(bolt11);
    if (!Number.isInteger(sats) || sats <= 0) return null;
    const monto = tag(pedido, 'amount');
    if (monto !== undefined && Number(monto) !== sats * 1000) return null;
    return {
      id: recibo.id,
      bolt11: bolt11.toLowerCase(),
      sats,
      persona: tag(pedido, 'vaquita') || null,
      fecha: recibo.created_at * 1000,
    };
  } catch {
    return null;
  }
}
