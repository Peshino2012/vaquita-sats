import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precioBtcArs } from '../precio.js';

const respuestas = (mapa) => async (url) => {
  const host = new URL(url).host;
  if (!(host in mapa)) throw new TypeError('offline');
  const v = mapa[host];
  return v instanceof Response ? v : new Response(JSON.stringify(v));
};

test('usa Yadio si responde', async () => {
  const r = await precioBtcArs(respuestas({ 'api.yadio.io': { result: 132770931.21 } }));
  assert.deepEqual(r, { arsPorBtc: 132770931, fuente: 'Yadio' });
});

test('si Yadio falla, usa la mediana de CriptoYa', async () => {
  const r = await precioBtcArs(
    respuestas({
      'api.yadio.io': new Response('error', { status: 502 }),
      'criptoya.com': { ripio: { ask: 134e6 }, satoshitango: { ask: 135e6 }, lemoncash: { ask: 133e6 }, roto: {} },
    }),
  );
  assert.deepEqual(r, { arsPorBtc: 134e6, fuente: 'CriptoYa' });
});

test('descarta valores absurdos y tira error si ninguna fuente sirve', async () => {
  const r = await precioBtcArs(respuestas({ 'api.yadio.io': { result: 12 }, 'api.coingecko.com': { bitcoin: { ars: 125e6 } } }));
  assert.equal(r.fuente, 'CoinGecko');
  await assert.rejects(precioBtcArs(respuestas({})), /cotización/);
});
