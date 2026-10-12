// Billetera Lightning de mentira para tests: responde como un servidor LNURL
// con soporte de zaps y firma recibos (kind 9735) como lo haría uno real.
import { generateSecretKey, getPublicKey, finalizeEvent } from '../vendor/nostr.js';

/** Factura con el formato de monto de BOLT11 (lnbc<monto>n1...), suficiente para los tests. */
export const facturaFalsa = (sats, sufijo = 'q') => `lnbc${sats * 10}n1${sufijo.repeat(60)}`;

export function crearBilleteraFalsa({ dominio = 'billetera.test', usuario = 'vaca', commentAllowed = 255, allowsNostr = true } = {}) {
  const sk = generateSecretKey();
  const nostrPubkey = getPublicKey(sk);
  const pedidos = [];
  const info = {
    tag: 'payRequest',
    callback: `https://${dominio}/lnurlp/${usuario}/callback`,
    minSendable: 1000,
    maxSendable: 1e11,
    metadata: '[["text/plain","vaca"]]',
    commentAllowed,
    ...(allowsNostr ? { allowsNostr: true, nostrPubkey } : {}),
  };
  return {
    sk,
    nostrPubkey,
    pedidos,
    direccion: `${usuario}@${dominio}`,
    /** Responde una URL como lo haría el servidor (para un fetch falso o una ruta de Playwright). */
    responder(url) {
      const u = new URL(url);
      if (u.pathname === `/.well-known/lnurlp/${usuario}`) return info;
      if (u.toString().startsWith(info.callback)) {
        const msat = Number(u.searchParams.get('amount'));
        const pedido = JSON.parse(u.searchParams.get('nostr'));
        const pr = facturaFalsa(msat / 1000, String.fromCharCode(113 + (pedidos.length % 8)));
        pedidos.push({ pr, pedido, msat });
        return { pr, routes: [] };
      }
      return { status: 'ERROR', reason: 'not found' };
    },
    /** Firma el recibo de zap de un pedido ya facturado, como al cobrarse. */
    recibo(pr, { firmante = sk, sats } = {}) {
      const { pedido } = pedidos.find((p) => p.pr === pr);
      const p = pedido.tags.find((t) => t[0] === 'p')[1];
      const tags = [['p', p], ['bolt11', sats ? facturaFalsa(sats) : pr], ['description', JSON.stringify(pedido)]];
      for (const n of ['e', 'a']) {
        const t = pedido.tags.find((x) => x[0] === n);
        if (t) tags.push(t);
      }
      tags.push(['P', pedido.pubkey]);
      return finalizeEvent({ kind: 9735, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, firmante);
    },
  };
}

export const fetchDe = (billetera) => async (url) => {
  const cuerpo = billetera.responder(String(url));
  return new Response(JSON.stringify(cuerpo), { status: cuerpo.status === 'ERROR' ? 404 : 200, headers: { 'content-type': 'application/json' } });
};
