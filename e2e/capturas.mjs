// Genera las capturas del README: node e2e/capturas.mjs
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { crearBilleteraFalsa } from '../test/billetera-falsa.js';
import { publicarEn } from './relay.mjs';

const RELAY = 'ws://127.0.0.1:7777';
const servidor = spawn(process.execPath, ['e2e/servidor.mjs', '--relay'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const billetera = crearBilleteraFalsa({ dominio: 'blink.sv', usuario: 'martin' });

const navegador = await chromium.launch();
async function pagina(opciones = {}) {
  const ctx = await navegador.newContext({ deviceScaleFactor: 2, ...opciones });
  const page = await ctx.newPage();
  await page.addInitScript((relay) => localStorage.setItem('vaquita:relays', JSON.stringify([relay])), RELAY);
  await page.route('https://api.yadio.io/**', (r) => r.fulfill({ json: { result: 132_770_931 } }));
  await page.route('https://blink.sv/**', (r) => r.fulfill({ json: billetera.responder(r.request().url()), headers: { 'access-control-allow-origin': '*' } }));
  return page;
}

const org = await pagina({ viewport: { width: 1280, height: 860 } });
await org.goto('http://127.0.0.1:4173/');
await org.getByLabel('¿Para qué es?').fill('Asado del sábado');
await org.getByLabel('¿Cuánto salió en total?').fill('60.000');
await org.getByLabel('¿Quiénes ponen?').fill('Martín\nAna\nBeto\nCaro\nDiego\nEli');
await org.getByLabel('Tu Lightning Address').fill(billetera.direccion);
await org.screenshot({ path: 'capturas/inicio.png' });
await org.getByRole('button', { name: 'Crear vaquita' }).click();
await org.locator('#v-titulo', { hasText: 'Asado' }).waitFor();
const link = await org.locator('#link-compartir').inputValue();

const celu = await pagina({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await celu.goto(link);
for (const nombre of ['Ana', 'Beto']) {
  await celu.getByRole('button', { name: `Pagar la parte de ${nombre}` }).click();
  await celu.locator('#pago-estado').filter({ hasText: 'Esperando' }).waitFor();
  if (nombre === 'Beto') await celu.screenshot({ path: 'capturas/pago-celular.png' });
  await publicarEn(RELAY, billetera.recibo(billetera.pedidos.at(-1).pr));
  await celu.getByText('¡Pago recibido!').waitFor();
  if (nombre === 'Beto') await celu.screenshot({ path: 'capturas/pago-recibido-celular.png' });
  await celu.getByRole('button', { name: 'Listo' }).click();
}
await org.locator('.persona', { hasText: 'Diego' }).getByRole('button', { name: 'Marcar pagado' }).click();
await org.locator('.chip-manual').nth(1).waitFor();
await celu.waitForTimeout(400);
await celu.screenshot({ path: 'capturas/vaquita-celular.png', fullPage: true });
await org.screenshot({ path: 'capturas/vaquita-escritorio.png', fullPage: true });

const oscuro = await pagina({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
await oscuro.goto(link);
await oscuro.locator('.chip-pagado').nth(1).waitFor();
await oscuro.screenshot({ path: 'capturas/vaquita-oscuro.png', fullPage: true });

await navegador.close();
servidor.kill();
console.log('capturas listas en vaquita/capturas/');
