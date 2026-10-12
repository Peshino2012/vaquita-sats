import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverDireccion, armarPedidoZap, pedirFactura, validarRecibo, codificarLnurl, urlLnurlp, ErrorLightning } from '../lightning.js';
import { generateSecretKey, getPublicKey, finalizeEvent } from '../vendor/nostr.js';
import { crearBilleteraFalsa, fetchDe } from './billetera-falsa.js';

const RELAYS = ['wss://relay.test'];
const vaquitaSk = generateSecretKey();
const vaquitaPk = getPublicKey(vaquitaSk);

async function pagarParte(billetera, { persona = 'p2', sats = 7532, pk = vaquitaPk } = {}) {
  const info = await resolverDireccion(billetera.direccion, fetchDe(billetera));
  const plantilla = armarPedidoZap({ info, vaquitaPk: pk, coordenada: `30078:${pk}:abc`, eventoId: 'e'.repeat(64), persona, sats, relays: RELAYS });
  const pedido = finalizeEvent(plantilla, generateSecretKey());
  const { pr } = await pedirFactura({ info, sats, pedido, fetchImpl: fetchDe(billetera) });
  return { info, pedido, pr };
}

test('lnurl: URL y bech32 según LUD-16/LUD-01', () => {
  assert.equal(urlLnurlp('Ana@Blink.sv'), 'https://blink.sv/.well-known/lnurlp/ana');
  assert.match(codificarLnurl('https://blink.sv/.well-known/lnurlp/ana'), /^lnurl1[02-9ac-hj-np-z]+$/);
});

test('resolverDireccion lee la configuración de zaps', async () => {
  const b = crearBilleteraFalsa();
  const info = await resolverDireccion(b.direccion, fetchDe(b));
  assert.equal(info.allowsNostr, true);
  assert.equal(info.nostrPubkey, b.nostrPubkey);
  assert.equal(info.callback, 'https://billetera.test/lnurlp/vaca/callback');
});

test('resolverDireccion: billetera sin zaps o inexistente', async () => {
  const sinZaps = crearBilleteraFalsa({ allowsNostr: false });
  assert.equal((await resolverDireccion(sinZaps.direccion, fetchDe(sinZaps))).allowsNostr, false);
  await assert.rejects(resolverDireccion('nadie@billetera.test', fetchDe(sinZaps)), (e) => e instanceof ErrorLightning && e.codigo === 'no-existe');
  await assert.rejects(resolverDireccion('a@b.test', () => Promise.reject(new TypeError('offline'))), (e) => e.codigo === 'red');
});

test('pedido de zap: etiquetas de NIP-57 más la persona', async () => {
  const b = crearBilleteraFalsa();
  const { pedido } = await pagarParte(b);
  const t = Object.fromEntries(pedido.tags.map((x) => [x[0], x.slice(1)]));
  assert.equal(pedido.kind, 9734);
  assert.deepEqual(t.relays, RELAYS);
  assert.deepEqual(t.amount, ['7532000']);
  assert.deepEqual(t.p, [vaquitaPk]);
  assert.deepEqual(t.vaquita, ['p2']);
  assert.equal(pedido.content, 'Aporte a la vaquita');
  const sinComentarios = await pagarParte(crearBilleteraFalsa({ commentAllowed: 0 }));
  assert.equal(sinComentarios.pedido.content, '');
});

test('pedirFactura controla monto y límites', async () => {
  const b = crearBilleteraFalsa();
  const { pr } = await pagarParte(b, { sats: 21 });
  assert.equal(pr, b.pedidos[0].pr);
  const info = await resolverDireccion(b.direccion, fetchDe(b));
  await assert.rejects(pedirFactura({ info: { ...info, minSendable: 50_000 }, sats: 21, pedido: {}, fetchImpl: fetchDe(b) }), (e) => e.codigo === 'monto');
  const mentirosa = async () => new Response(JSON.stringify({ pr: 'lnbc990n1' + 'q'.repeat(60) }));
  await assert.rejects(pedirFactura({ info, sats: 21, pedido: {}, fetchImpl: mentirosa }), /no coincide/);
  const testnet = async () => new Response(JSON.stringify({ pr: 'lntb210n1' + 'q'.repeat(60) }));
  await assert.rejects(pedirFactura({ info, sats: 21, pedido: {}, fetchImpl: testnet }), /red principal/);
});

test('validarRecibo acepta un recibo legítimo', async () => {
  const b = crearBilleteraFalsa();
  const { pr } = await pagarParte(b, { persona: 'p3', sats: 500 });
  const aporte = validarRecibo(b.recibo(pr), { nostrPubkey: b.nostrPubkey, vaquitaPk });
  assert.equal(aporte.sats, 500);
  assert.equal(aporte.persona, 'p3');
  assert.equal(aporte.bolt11, pr);
});

test('validarRecibo rechaza recibos falsos', async () => {
  const b = crearBilleteraFalsa();
  const { pr } = await pagarParte(b, { sats: 500 });
  const opciones = { nostrPubkey: b.nostrPubkey, vaquitaPk };
  // Firmado por alguien que no es la billetera de quien organiza.
  assert.equal(validarRecibo(b.recibo(pr, { firmante: generateSecretKey() }), opciones), null);
  // La factura dice otro monto que el pedido.
  assert.equal(validarRecibo(b.recibo(pr, { sats: 5000 }), opciones), null);
  // Contenido alterado después de firmar.
  const alterado = { ...b.recibo(pr), tags: [...b.recibo(pr).tags] };
  alterado.tags[1] = ['bolt11', 'lnbc50000n1' + 'q'.repeat(60)];
  assert.equal(validarRecibo(alterado, opciones), null);
  // Recibo de otra vaquita.
  const otra = await pagarParte(b, { pk: getPublicKey(generateSecretKey()) });
  assert.equal(validarRecibo(b.recibo(otra.pr), opciones), null);
  assert.equal(validarRecibo({ kind: 1 }, opciones), null);
  assert.equal(validarRecibo(null, opciones), null);
});
