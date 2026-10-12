import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatoPesos, leerMonto, repartir, pesosASats, satsAPesos, armarVaquita, estadoVaquita, armarLink, leerLink, esLightningAddress, leerNombres, formatoSats, textoRecordatorio } from '../logic.js';

test('leerMonto entiende el formato argentino', () => {
  assert.equal(leerMonto('30.000'), 30000);
  assert.equal(leerMonto('$ 1.234,50'), 1234.5);
  assert.equal(leerMonto('2500'), 2500);
  assert.equal(leerMonto('10.000 sats'), 10000);
  assert.ok(Number.isNaN(leerMonto('')));
  assert.ok(Number.isNaN(leerMonto('abc')));
});

test('repartir no pierde ni inventa unidades', () => {
  assert.deepEqual(repartir(10, 3), [4, 3, 3]);
  assert.deepEqual(repartir(9, 3), [3, 3, 3]);
  for (const [t, n] of [[1000001, 7], [5, 9], [0, 2]]) assert.equal(repartir(t, n).reduce((a, b) => a + b, 0), t);
  assert.throws(() => repartir(10, 0), RangeError);
  assert.throws(() => repartir(1.5, 2), RangeError);
});

test('pesosASats redondea hacia arriba y satsAPesos vuelve', () => {
  // 1 BTC = $100.000.000 → $10.000 = 0,0001 BTC = 10.000 sats exactos.
  assert.equal(pesosASats(10000, 100_000_000), 10000);
  assert.equal(pesosASats(10000.01, 100_000_000), 10001);
  assert.equal(pesosASats(10000, 132_770_931), 7532);
  assert.ok(Number.isNaN(pesosASats(100, 0)));
  assert.equal(satsAPesos(10000, 100_000_000), 10000);
});

test('armarVaquita reparte en pesos y convierte cada parte a sats', () => {
  const r = armarVaquita({ titulo: '  Asado   del sábado ', total: '30.000', nombres: 'Martín\nAna\nBeto', direccion: 'Vos@Blink.sv', arsPorBtc: 100_000_000, fuentePrecio: 'Yadio', yoPague: true, ahora: Date.UTC(2026, 9, 12) });
  assert.equal(r.ok, true);
  assert.equal(r.datos.titulo, 'Asado del sábado');
  assert.equal(r.datos.direccion, 'vos@blink.sv');
  assert.deepEqual(r.datos.personas.map((p) => [p.id, p.nombre, p.pesos, p.sats]), [['p1', 'Martín', 10000, 10000], ['p2', 'Ana', 10000, 10000], ['p3', 'Beto', 10000, 10000]]);
  assert.deepEqual(r.datos.manuales, { p1: true });
  assert.equal(r.datos.precio.fuente, 'Yadio');
});

test('armarVaquita en sats y con resto', () => {
  const r = armarVaquita({ titulo: 'Pizza', total: '1000', moneda: 'SAT', nombres: ['A', 'B', 'C'], direccion: 'a@coinos.io' });
  assert.deepEqual(r.datos.personas.map((p) => p.sats), [334, 333, 333]);
  assert.equal(r.datos.precio, null);
});

test('armarVaquita marca los errores del formulario', () => {
  const r = armarVaquita({ titulo: '', total: '0', nombres: 'Ana\nana', direccion: 'no-es-una-direccion', arsPorBtc: 1e8 });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errores).sort(), ['direccion', 'nombres', 'titulo', 'total']);
  assert.match(r.errores.nombres, /repetidos/);
  const sinPrecio = armarVaquita({ titulo: 'x', total: '100', nombres: 'A,B', direccion: 'a@b.co' });
  assert.match(sinPrecio.errores.total, /cotización/);
});

const datos = {
  personas: [
    { id: 'p1', nombre: 'Martín', sats: 100 },
    { id: 'p2', nombre: 'Ana', sats: 100 },
    { id: 'p3', nombre: 'Beto', sats: 100 },
    { id: 'p4', nombre: 'Caro', sats: 100 },
  ],
  manuales: { p1: true },
};

test('estadoVaquita suma zaps, respeta marcas manuales y descarta duplicados', () => {
  const aportes = [
    { id: 'r1', bolt11: 'lnbc1', sats: 100, persona: 'p2' },
    { id: 'r1-copia', bolt11: 'lnbc1', sats: 100, persona: 'p2' },
    { id: 'r2', bolt11: 'lnbc2', sats: 40, persona: 'p3' },
    { id: 'r3', bolt11: 'lnbc3', sats: 21, persona: null },
  ];
  const e = estadoVaquita(datos, aportes);
  assert.deepEqual(e.personas.map((p) => p.estado), ['manual', 'pagado', 'parcial', 'pendiente']);
  assert.equal(e.personas[2].falta, 60);
  assert.equal(e.totalSats, 400);
  assert.equal(e.saldadoSats, 240);
  assert.equal(e.recibidoSats, 161);
  assert.equal(e.sinAsignar, 21);
  assert.equal(e.listas, 2);
  assert.equal(e.completa, false);
  assert.equal(e.progreso, 0.6);
});

test('estadoVaquita: completa cuando todos pagaron', () => {
  const aportes = ['p2', 'p3', 'p4'].map((p, i) => ({ id: `r${i}`, bolt11: `lnbc${i}`, sats: 100, persona: p }));
  const e = estadoVaquita(datos, aportes);
  assert.equal(e.completa, true);
  assert.equal(e.progreso, 1);
});

test('links: ida y vuelta, y rechaza basura', () => {
  const clave = 'A'.repeat(43);
  const link = armarLink('https://x.github.io/vaquita/#viejo', { naddr: 'naddr1abc', clave, admin: 'f'.repeat(64) });
  assert.equal(link, `https://x.github.io/vaquita/#v=naddr1abc&k=${clave}&a=${'f'.repeat(64)}`);
  assert.deepEqual(leerLink(new URL(link).hash), { naddr: 'naddr1abc', clave, admin: 'f'.repeat(64) });
  assert.equal(leerLink('#v=naddr1abc&k=corta'), null);
  assert.equal(leerLink('#v=<script>&k=' + clave), null);
  assert.equal(leerLink(`#v=naddr1abc&k=${clave}&a=nohex`).admin, null);
});

test('helpers de texto', () => {
  assert.ok(esLightningAddress('martin@walletofsatoshi.com'));
  assert.ok(!esLightningAddress('martin@localhost'));
  assert.deepEqual(leerNombres('Ana, Beto\n\n  Caro  López ;Dani'), ['Ana', 'Beto', 'Caro López', 'Dani']);
  assert.equal(formatoSats(12345), '12.345 sats');
  assert.equal(formatoPesos(10000).replace(/\s/g, ' '), '$ 10.000');
  assert.equal(formatoPesos(1234.5).replace(/\s/g, ' '), '$ 1.234,50');
  assert.equal(formatoPesos(NaN), '—');
  assert.match(textoRecordatorio({ titulo: 'Asado' }, [{ nombre: 'Ana' }, { nombre: 'Beto' }], 'https://l'), /Ana, Beto/);
});
