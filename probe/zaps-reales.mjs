// Prueba con billeteras y relays REALES (corre en GitHub Actions):
// 1) cada billetera acepta nuestro pedido de zap y devuelve una factura del
//    monto correcto (no se paga nada); 2) los relays aceptan una vaquita
//    cifrada y la devuelven al pedirla, como hace la app.
import { writeFileSync } from 'node:fs';
import { resolverDireccion, armarPedidoZap, pedirFactura } from '../lightning.js';
import * as N from '../nostr.js';
import { cifrar, descifrar, nuevaClave } from '../cripto.js';

const DIRECCIONES = ['blink@blink.sv', 'walletofsatoshi@walletofsatoshi.com', 'coinos@coinos.io', 'primal@primal.net', 'jack@strike.me',
  'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m@npub.cash'];
const resultado = { fecha: new Date().toISOString(), billeteras: [], relays: [] };
const vaquita = N.nuevaIdentidad();

for (const direccion of DIRECCIONES) {
  const r = { direccion };
  try {
    const info = await resolverDireccion(direccion);
    r.allowsNostr = info.allowsNostr;
    const sats = Math.max(21, Math.ceil(info.minSendable / 1000));
    const plantilla = armarPedidoZap({ info, vaquitaPk: vaquita.pk, coordenada: N.coordenada(vaquita.pk, 'prueba'), eventoId: 'e'.repeat(64), persona: 'p2', sats, relays: N.RELAYS });
    const { pr, verify } = await pedirFactura({ info, sats, pedido: N.firmar(plantilla, N.nuevaIdentidad().sk) });
    Object.assign(r, { ok: true, sats, factura: pr.slice(0, 24) + '…', verify: Boolean(verify) });
  } catch (e) {
    Object.assign(r, { ok: false, error: e.message });
  }
  resultado.billeteras.push(r);
}

const clave = nuevaClave();
const d = 'prueba-' + Date.now();
for (const relay of N.RELAYS) {
  const r = { relay };
  try {
    const datos = { titulo: 'Prueba de Vaquita (CI)', personas: [] };
    const ev = await N.publicarVaquita({ sk: vaquita.sk, d, contenido: await cifrar(datos, clave), relays: [relay] });
    const leido = await new Promise((resolve) => {
      const cerrar = N.escuchar({ pubkey: vaquita.pk, d, relays: [relay], onVaquita: (x) => resolve(x), onRecibo: () => {}, onListo: () => setTimeout(() => resolve(null), 1500) });
      setTimeout(() => { cerrar(); resolve(null); }, 10000);
    });
    r.publicado = true;
    r.leido = Boolean(leido && leido.id === ev.id && (await descifrar(leido.content, clave)).titulo === datos.titulo);
  } catch (e) {
    r.error = e.message;
  }
  resultado.relays.push(r);
}

writeFileSync(new URL('./zaps-reales.json', import.meta.url), JSON.stringify(resultado, null, 2) + '\n');
console.log(JSON.stringify(resultado, null, 2));
process.exit(0);
