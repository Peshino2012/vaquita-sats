// Flujo completo en un navegador real: crear la vaquita, abrirla desde otro
// dispositivo, pagar con un zap y ver cómo se verifica en vivo para todos.
// La billetera Lightning es falsa (test/billetera-falsa.js) y el relay Nostr
// es local (e2e/relay.mjs); todo lo demás es la app tal cual se publica.
import { test, expect } from '@playwright/test';
import { generateSecretKey } from '../vendor/nostr.js';
import { crearBilleteraFalsa } from '../test/billetera-falsa.js';
import { publicarEn } from './relay.mjs';

const RELAY = 'ws://127.0.0.1:7777';
const PRECIO = 100_000_000; // 1 BTC = $100.000.000 → $1 = 1 sat, fácil de verificar

async function preparar(page, billetera) {
  await page.addInitScript((relay) => localStorage.setItem('vaquita:relays', JSON.stringify([relay])), RELAY);
  await page.route('https://api.yadio.io/**', (r) => r.fulfill({ json: { result: PRECIO } }));
  await page.route(`https://${billetera.direccion.split('@')[1]}/**`, (r) =>
    r.fulfill({ json: billetera.responder(r.request().url()), headers: { 'access-control-allow-origin': '*' } }),
  );
}

async function crearVaquita(page, billetera, { titulo = 'Asado del sábado', total = '40.000', nombres = 'Martín\nAna\nBeto\nCaro' } = {}) {
  await page.goto('./');
  await page.getByLabel('¿Para qué es?').fill(titulo);
  await page.getByLabel('¿Cuánto salió en total?').fill(total);
  await page.getByLabel('¿Quiénes ponen?').fill(nombres);
  await page.getByLabel('Tu Lightning Address').fill(billetera.direccion);
  await page.getByRole('button', { name: 'Crear vaquita' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(titulo);
  return page.locator('#link-compartir').inputValue();
}

const fila = (page, nombre) => page.locator('.persona', { has: page.locator('.persona-nombre', { hasText: new RegExp(`^${nombre}$`) }) });

test('crear, compartir y pagar con zaps verificados', async ({ page, browser }) => {
  const billetera = crearBilleteraFalsa();
  await preparar(page, billetera);

  await page.goto('./');
  await page.getByLabel('¿Cuánto salió en total?').fill('40.000');
  await page.getByLabel('¿Quiénes ponen?').fill('Martín\nAna\nBeto\nCaro');
  await expect(page.locator('#previa-parte')).toHaveText('Cada uno pone $ 10.000 ≈ 10.000 sats.');

  const link = await crearVaquita(page, billetera);
  expect(link).toMatch(/#v=naddr1[a-z0-9]+&k=[A-Za-z0-9_-]{43}$/);
  await expect(page.locator('#v-progreso')).toHaveText('10.000 sats de 40.000 sats · 1 de 4 personas listas');
  await expect(fila(page, 'Martín').locator('.chip')).toHaveText('Pagó (marcado a mano)');
  await expect(page.locator('#panel-admin')).toBeVisible();

  // Otra persona abre el link en su celular (otro navegador, sin datos guardados).
  const otro = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const celu = await otro.newPage();
  await preparar(celu, billetera);
  await celu.goto(link);
  await expect(celu.getByRole('heading', { level: 1 })).toHaveText('Asado del sábado');
  await expect(celu.locator('#panel-admin')).toBeHidden();

  // Beto paga su parte.
  await celu.getByRole('button', { name: 'Pagar la parte de Beto' }).click();
  const dialogo = celu.getByRole('dialog');
  await expect(dialogo.getByRole('heading')).toHaveText('Pagar la parte de Beto');
  await expect(dialogo.locator('#pago-sats')).toHaveText('10.000 sats');
  await expect(dialogo.getByRole('img', { name: 'QR de la factura Lightning' })).toBeVisible();
  await expect(dialogo.locator('#pago-estado')).toContainText('Esperando el pago');

  const { pr, pedido } = billetera.pedidos.at(-1);
  await expect(dialogo.getByRole('link', { name: 'Abrir mi billetera' })).toHaveAttribute('href', `lightning:${pr}`);
  const tags = Object.fromEntries(pedido.tags.map((t) => [t[0], t.slice(1)]));
  expect(tags.amount).toEqual(['10000000']);
  expect(tags.vaquita).toEqual(['p3']);

  // La billetera cobra y publica el recibo de zap: se verifica solo.
  await publicarEn(RELAY, billetera.recibo(pr));
  await expect(dialogo.getByText('¡Pago recibido!')).toBeVisible();
  await dialogo.getByRole('button', { name: 'Listo' }).click();
  await expect(fila(celu, 'Beto').locator('.chip')).toHaveText('Pagó ✓');
  // ...y le aparece en vivo a quien organiza.
  await expect(fila(page, 'Beto').locator('.chip')).toHaveText('Pagó ✓');
  await expect(page.locator('#v-progreso')).toHaveText('20.000 sats de 40.000 sats · 2 de 4 personas listas');
  await expect(page.locator('#actividad li')).toHaveCount(1);
  await expect(page.locator('#actividad li').first()).toContainText('Beto · 10.000 sats');

  // Un recibo trucho (firmado por otra clave) no cuenta.
  await celu.getByRole('button', { name: 'Pagar la parte de Caro' }).click();
  await expect(dialogo.locator('#pago-estado')).toContainText('Esperando el pago');
  const caro = billetera.pedidos.at(-1).pr;
  await publicarEn(RELAY, billetera.recibo(caro, { firmante: generateSecretKey() }));
  await celu.waitForTimeout(600);
  await expect(dialogo.locator('#pago-estado')).toContainText('Esperando el pago');
  await dialogo.getByRole('button', { name: 'Cerrar' }).click();
  await expect(fila(celu, 'Caro').locator('.chip')).toHaveText('Pendiente');

  // Quien organiza marca a Ana a mano (le pagó en efectivo): se ve en el celu.
  await fila(page, 'Ana').getByRole('button', { name: 'Marcar pagado' }).click();
  await expect(fila(celu, 'Ana').locator('.chip')).toHaveText('Pagó (marcado a mano)');

  // Caro paga de verdad y la vaquita queda completa.
  await publicarEn(RELAY, billetera.recibo(caro));
  await expect(celu.locator('#v-completa')).toBeVisible();
  await expect(page.locator('#v-completa')).toBeVisible();
  await expect(page.locator('#v-progreso')).toHaveText('40.000 sats de 40.000 sats · 4 de 4 personas listas');

  // Sin scroll horizontal en el celular.
  expect(await celu.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await otro.close();
});

test('el contenido viaja cifrado: el relay no ve nombres ni montos', async ({ page }) => {
  const billetera = crearBilleteraFalsa();
  await preparar(page, billetera);
  await crearVaquita(page, billetera, { titulo: 'Cumple de Lucía', nombres: 'Lucía\nPedro' });
  const eventos = await page.evaluate(
    (relay) =>
      new Promise((resolve) => {
        const ws = new WebSocket(relay);
        const vistos = [];
        ws.onopen = () => ws.send(JSON.stringify(['REQ', 'x', { kinds: [30078] }]));
        ws.onmessage = (m) => {
          const d = JSON.parse(m.data);
          if (d[0] === 'EVENT') vistos.push(d[2]);
          if (d[0] === 'EOSE') resolve(vistos);
        };
      }),
    RELAY,
  );
  const crudo = JSON.stringify(eventos);
  expect(eventos.length).toBeGreaterThan(0);
  expect(crudo).not.toContain('Lucía');
  expect(crudo).not.toContain('Pedro');
  expect(crudo).not.toContain('Cumple');
});

test('el link de administración funciona en otro dispositivo y no queda en la barra', async ({ page, browser }) => {
  const billetera = crearBilleteraFalsa();
  await preparar(page, billetera);
  await crearVaquita(page, billetera);
  await page.getByText('Link de administración').click();
  const admin = await page.locator('#link-admin').inputValue();
  expect(admin).toMatch(/&a=[0-9a-f]{64}$/);

  const otro = await browser.newContext();
  const compu = await otro.newPage();
  await preparar(compu, billetera);
  await compu.goto(admin);
  await expect(compu.locator('#panel-admin')).toBeVisible();
  expect(compu.url()).not.toContain('&a=');
  await otro.close();
});

test('errores del formulario y billetera sin zaps', async ({ page }) => {
  const billetera = crearBilleteraFalsa({ allowsNostr: false });
  await preparar(page, billetera);
  await page.goto('./');
  await page.getByRole('button', { name: 'Crear vaquita' }).click();
  await expect(page.locator('#err-titulo')).toBeVisible();
  await expect(page.locator('#err-nombres')).toBeVisible();
  await expect(page.locator('#err-direccion')).toBeVisible();
  await expect(page.getByLabel('¿Para qué es?')).toBeFocused();

  await page.getByLabel('¿Para qué es?').fill('Pizza');
  await page.getByLabel('¿Cuánto salió en total?').fill('20.000');
  await page.getByLabel('¿Quiénes ponen?').fill('Ana\nBeto');
  await page.getByLabel('Tu Lightning Address').fill(billetera.direccion);
  await page.getByRole('button', { name: 'Crear vaquita' }).click();
  await expect(page.locator('#err-direccion')).toContainText('no emite comprobantes de zap');
});

test('links rotos o con la clave equivocada', async ({ page }) => {
  const billetera = crearBilleteraFalsa();
  await preparar(page, billetera);
  const link = await crearVaquita(page, billetera);

  await page.goto(link.replace(/k=[^&]+/, `k=${'A'.repeat(43)}`));
  await expect(page.locator('#cargando-txt')).toContainText('la clave del link no corresponde');

  await page.goto(link.replace(/v=naddr1[a-z0-9]+/, 'v=naddr1qqqqqq'));
  await expect(page.locator('#cargando-txt')).toContainText('incompleto o roto');
});

test('propina para el proyecto: factura, QR y confirmación con el recibo de zap', async ({ page }) => {
  const billetera = crearBilleteraFalsa();
  const propinas = crearBilleteraFalsa({ dominio: 'walletofsatoshi.com', usuario: 'engagedsheet14' });
  await preparar(page, billetera);
  await preparar(page, propinas);
  await page.goto('./');
  await page.getByRole('button', { name: '1.000 sats' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo.getByRole('heading')).toHaveText('Propina para Vaquita');
  await expect(dialogo.getByRole('img', { name: 'QR de la factura Lightning' })).toBeVisible();
  const { pr, pedido } = propinas.pedidos.at(-1);
  expect(pedido.tags.find((t) => t[0] === 'amount')[1]).toBe('1000000');
  expect(pedido.content).toBe('Propina para Vaquita');
  await publicarEn(RELAY, propinas.recibo(pr));
  await expect(dialogo.getByText('¡Gracias por la propina!')).toBeVisible();
});
