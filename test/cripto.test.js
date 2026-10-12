import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cifrar, descifrar, nuevaClave, aBase64url, deBase64url } from '../cripto.js';

test('cifrar y descifrar ida y vuelta', async () => {
  const clave = nuevaClave();
  assert.equal(clave.length, 43);
  const datos = { titulo: 'Asado 🐄', personas: [{ nombre: 'Ñandú', pesos: 1234.5 }] };
  const c = await cifrar(datos, clave);
  assert.ok(c.startsWith('v1:'));
  assert.ok(!c.includes('Asado'));
  assert.deepEqual(await descifrar(c, clave), datos);
});

test('con otra clave o contenido alterado, falla', async () => {
  const c = await cifrar({ a: 1 }, nuevaClave());
  await assert.rejects(descifrar(c, nuevaClave()));
  const bytes = deBase64url(c.slice(3));
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(descifrar('v1:' + aBase64url(bytes), nuevaClave()));
  await assert.rejects(descifrar('texto plano', nuevaClave()));
});

test('mismo contenido, cifrado distinto (IV aleatorio)', async () => {
  const clave = nuevaClave();
  assert.notEqual(await cifrar({ a: 1 }, clave), await cifrar({ a: 1 }, clave));
});
