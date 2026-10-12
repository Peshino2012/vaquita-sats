// Consulta servicios reales desde GitHub Actions (el sandbox del agente no
// llega a estos hosts) y guarda qué soporta cada uno: zaps (NIP-57),
// verificación de pagos (LUD-21) y CORS para usarlos desde el navegador.
import { writeFileSync } from 'node:fs';

const ORIGIN = 'https://peshino2012.github.io';
const direcciones = [
  'hello@getalby.com', 'blink@blink.sv', 'galoy@blink.sv',
  'walletofsatoshi@walletofsatoshi.com', 'coinos@coinos.io', 'adam@coinos.io',
  'lacrypta@lawallet.ar', 'agustin@lawallet.ar', 'hackathons@lacrypta.ar', 'lacrypta@lacrypta.ar',
  'primal@primal.net', 'sn@stacker.news', 'jack@strike.me', 'support@minibits.cash',
  'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m@npub.cash',
];
const precios = [
  'https://criptoya.com/api/btc/ars/0.1',
  'https://criptoya.com/api/bitso/btc/ars',
  'https://api.yadio.io/exrates/btc',
  'https://api.yadio.io/convert/1/btc/ars',
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=ars,usd',
  'https://mempool.space/api/v1/prices',
  'https://dolarapi.com/v1/dolares/cripto',
];
const relays = [
  'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band',
  'wss://relay.lawallet.ar', 'wss://relay.lacrypta.ar', 'wss://relay.snort.social', 'wss://nostr.mom',
];

const corta = (s, n = 300) => (s.length > n ? s.slice(0, n) + '…' : s);

async function pedir(url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, headers: { Origin: ORIGIN, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch {}
    return { status: r.status, cors: r.headers.get('access-control-allow-origin'), ms: Date.now() - t0, json, texto: corta(texto) };
  } catch (e) {
    return { error: String(e.cause?.code || e.message), ms: Date.now() - t0 };
  }
}

async function probarDireccion(dir) {
  const [user, dominio] = dir.split('@');
  const info = await pedir(`https://${dominio}/.well-known/lnurlp/${user}`);
  const r = { direccion: dir, status: info.status, error: info.error, corsInfo: info.cors };
  const j = info.json;
  if (!j || !j.callback) { r.texto = info.texto; return r; }
  Object.assign(r, {
    allowsNostr: j.allowsNostr ?? false, nostrPubkey: j.nostrPubkey ?? null,
    commentAllowed: j.commentAllowed ?? 0, minSendable: j.minSendable, maxSendable: j.maxSendable,
    callbackHost: new URL(j.callback).host,
  });
  const monto = Math.max(j.minSendable || 1000, 10000);
  const cb = new URL(j.callback);
  cb.searchParams.set('amount', String(monto));
  const fac = await pedir(cb.toString());
  r.corsCallback = fac.cors;
  r.callbackStatus = fac.status ?? fac.error;
  r.hayFactura = Boolean(fac.json?.pr);
  r.verify = fac.json?.verify ?? null;
  if (!fac.json?.pr) r.callbackTexto = fac.texto;
  if (r.verify) {
    const v = await pedir(r.verify);
    r.corsVerify = v.cors;
    r.verifyRespuesta = v.json ?? v.texto ?? v.error;
  }
  return r;
}

function probarRelay(url) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let fin = false;
    const listo = (x) => { if (!fin) { fin = true; try { ws.close(); } catch {} resolve({ relay: url, ms: Date.now() - t0, ...x }); } };
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return resolve({ relay: url, error: String(e.message) }); }
    let eventos = 0;
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'p', { kinds: [9735], limit: 2 }]));
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d[0] === 'EVENT') eventos++;
      if (d[0] === 'EOSE') listo({ ok: true, eventos });
      if (d[0] === 'CLOSED' || d[0] === 'NOTICE' || d[0] === 'AUTH') listo({ ok: false, mensaje: d });
    };
    ws.onerror = (e) => listo({ ok: false, error: String(e.message || 'error') });
    setTimeout(() => listo({ ok: false, error: 'timeout' }), 12000);
  });
}

const resultado = { fecha: new Date().toISOString(), direcciones: [], precios: [], relays: [] };
for (const d of direcciones) resultado.direcciones.push(await probarDireccion(d));
for (const p of precios) { const x = await pedir(p); resultado.precios.push({ url: p, status: x.status ?? x.error, cors: x.cors, muestra: x.texto }); }
for (const r of relays) resultado.relays.push(await probarRelay(r));
writeFileSync(new URL('./resultados.json', import.meta.url), JSON.stringify(resultado, null, 2) + '\n');
console.log(JSON.stringify(resultado, null, 2));
