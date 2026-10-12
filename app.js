// Interfaz de Vaquita. La lógica pura está en logic.js; acá solo hay DOM,
// almacenamiento local y el cableado entre Nostr, Lightning y la pantalla.
import * as L from './logic.js';
import { cifrar, descifrar, nuevaClave, aBase64url } from './cripto.js';
import { resolverDireccion, armarPedidoZap, pedirFactura, validarRecibo } from './lightning.js';
import { precioBtcArs } from './precio.js';
import * as N from './nostr.js';
import { svgQR } from './qr.js';
import { PROPINAS } from './config.js';

const $ = (id) => document.getElementById(id);
const BASE = location.origin + location.pathname;

/* ---------- Almacenamiento local (puede no estar disponible) ---------- */

function leer(clave, porDefecto) {
  try {
    const v = JSON.parse(localStorage.getItem(clave));
    return v ?? porDefecto;
  } catch {
    return porDefecto;
  }
}
function escribir(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {}
}

/** Los tests (y quien quiera su propio relay) pueden cambiar la lista con localStorage["vaquita:relays"]. */
function relaysPorDefecto() {
  const r = leer('vaquita:relays', null);
  return Array.isArray(r) && r.length && r.every((x) => /^wss?:\/\/[^\s]+$/.test(x)) ? r : N.RELAYS;
}

const misVaquitas = () => {
  const v = leer('vaquita:mias', []);
  return Array.isArray(v) ? v : [];
};

function recordar(entrada) {
  const lista = misVaquitas();
  const i = lista.findIndex((v) => v.naddr === entrada.naddr);
  const previa = i >= 0 ? lista.splice(i, 1)[0] : { creada: Date.now() };
  lista.unshift({ ...previa, ...entrada, sk: entrada.sk || previa.sk || null });
  escribir('vaquita:mias', lista.slice(0, 30));
}

/* ---------- Utilidades de interfaz ---------- */

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

async function copiar(texto, aviso = 'Copiado') {
  try {
    await navigator.clipboard.writeText(texto);
    toast(aviso);
  } catch {
    toast('No se pudo copiar: mantené apretado el texto para copiarlo');
  }
}

function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...hijos.filter((h) => h != null && h !== false));
  return e;
}

function mostrarVista(nombre) {
  $('vista-inicio').hidden = nombre !== 'inicio';
  $('vista-vaquita').hidden = nombre !== 'vaquita';
  window.scrollTo(0, 0);
}

const fechaCorta = (iso) => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ---------- Inicio: crear una vaquita ---------- */

const app = { precio: null, actual: null, pago: null, semilla: null };
const form = $('form-nueva');
const CAMPOS = ['titulo', 'total', 'nombres', 'direccion'];

async function cargarPrecio() {
  $('previa-precio').textContent = 'Buscando la cotización del bitcoin…';
  try {
    app.precio = await precioBtcArs();
  } catch {
    app.precio = null;
  }
  actualizarPrevia();
}

function actualizarPrevia() {
  const f = new FormData(form);
  const moneda = f.get('moneda');
  const total = L.leerMonto(f.get('total'));
  const n = L.leerNombres(f.get('nombres')).length;
  const p = app.precio;
  $('previa-precio').textContent = p
    ? `1 BTC = ${L.formatoPesos(p.arsPorBtc)} según ${p.fuente}.`
    : 'No pudimos obtener la cotización del bitcoin: podés cargar el total en sats.';
  if (!(total > 0) || n < 2) {
    $('previa-parte').textContent = 'Completá el total y los nombres para ver cuánto pone cada uno.';
    return;
  }
  if (moneda === 'ARS') {
    const parte = total / n;
    $('previa-parte').textContent = p
      ? `Cada uno pone ${L.formatoPesos(parte)} ≈ ${L.formatoSats(L.pesosASats(parte, p.arsPorBtc))}.`
      : `Cada uno pone ${L.formatoPesos(parte)}.`;
  } else {
    const parte = Math.ceil(total / n);
    $('previa-parte').textContent = `Cada uno pone ${L.formatoSats(parte)}${p ? ` ≈ ${L.formatoPesos(L.satsAPesos(parte, p.arsPorBtc))}` : ''}.`;
  }
}

function limpiarErrores() {
  for (const c of [...CAMPOS, 'crear']) {
    const e = $(`err-${c}`);
    e.hidden = true;
    e.textContent = '';
    $(c)?.removeAttribute('aria-invalid');
  }
}

function mostrarErrores(errores) {
  let primero = null;
  for (const [campo, msg] of Object.entries(errores)) {
    const e = $(`err-${campo}`);
    if (!e) continue;
    e.textContent = msg;
    e.hidden = false;
    $(campo)?.setAttribute('aria-invalid', 'true');
    primero ??= $(campo);
  }
  primero?.focus();
}

function ocupado(boton, texto) {
  boton.dataset.texto ??= boton.textContent;
  boton.disabled = Boolean(texto);
  boton.textContent = texto || boton.dataset.texto;
}

async function crear(evento) {
  evento.preventDefault();
  limpiarErrores();
  const f = new FormData(form);
  const r = L.armarVaquita({
    titulo: f.get('titulo'),
    total: f.get('total'),
    moneda: f.get('moneda'),
    nombres: f.get('nombres'),
    direccion: f.get('direccion'),
    arsPorBtc: app.precio?.arsPorBtc,
    fuentePrecio: app.precio?.fuente,
    yoPague: f.get('yoPague') === 'on',
  });
  if (!r.ok) return mostrarErrores(r.errores);

  const boton = $('btn-crear');
  try {
    ocupado(boton, 'Verificando tu billetera…');
    const info = await resolverDireccion(r.datos.direccion);
    if (!info.allowsNostr) {
      return mostrarErrores({
        direccion: 'Esta billetera no emite comprobantes de zap (NIP-57), así que no podríamos verificar los pagos. Probá con Blink, Wallet of Satoshi, Coinos o Primal.',
      });
    }
    const minimo = Math.ceil(info.minSendable / 1000);
    if (r.datos.personas.some((p, i) => p.sats < minimo && !(i === 0 && r.datos.manuales.p1))) {
      return mostrarErrores({ total: `Tu billetera recibe pagos desde ${L.formatoSats(minimo)}, y la parte de cada uno es menor.` });
    }
    const datos = { ...r.datos, nostrPubkey: info.nostrPubkey };

    ocupado(boton, 'Publicando en Nostr…');
    const { sk, pk } = N.nuevaIdentidad();
    const clave = nuevaClave();
    const d = aBase64url(crypto.getRandomValues(new Uint8Array(12)));
    const relays = relaysPorDefecto();
    const ev = await N.publicarVaquita({ sk, d, contenido: await cifrar(datos, clave), relays });
    const naddr = N.codificarNaddr({ pubkey: pk, d, relays });
    recordar({ naddr, clave, sk, titulo: datos.titulo });
    app.semilla = { naddr, evento: ev, datos };
    form.reset();
    actualizarPrevia();
    location.hash = new URL(L.armarLink(BASE, { naddr, clave })).hash;
  } catch (e) {
    $('err-crear').textContent = e.message || 'Algo salió mal. Probá de nuevo.';
    $('err-crear').hidden = false;
  } finally {
    ocupado(boton, null);
  }
}

function renderMias() {
  const lista = misVaquitas();
  $('mis-vaquitas').hidden = lista.length === 0;
  $('lista-mias').replaceChildren(
    ...lista.map((v) =>
      el(
        'li',
        {},
        el(
          'a',
          { href: L.armarLink(BASE, { naddr: v.naddr, clave: v.clave }) },
          el('span', { class: 'mias-titulo' }, v.titulo || 'Vaquita'),
          el('small', {}, `${v.sk ? 'organizás' : 'participás'} · ${L.haceCuanto(v.creada)}`),
        ),
      ),
    ),
  );
}

/* ---------- Vista de una vaquita ---------- */

function cargando(texto, { reintentar = false } = {}) {
  $('cargando').hidden = false;
  $('contenido').hidden = true;
  $('cargando-txt').textContent = texto;
  $('btn-reintentar').hidden = !reintentar;
  $('volver-inicio').hidden = !reintentar;
}

function cerrarActual() {
  const a = app.actual;
  if (!a) return;
  a.cerrar?.();
  clearTimeout(a.timeout);
  app.actual = null;
}

function abrirVaquita(link) {
  cerrarActual();
  mostrarVista('vaquita');
  let dec;
  try {
    dec = N.decodificarNaddr(link.naddr);
  } catch {
    return cargando('El link de la vaquita está incompleto o roto. Pedíselo de nuevo a quien organiza.', { reintentar: false });
  }
  const relays = [...new Set([...dec.relays, ...relaysPorDefecto()])].slice(0, 6);
  const guardada = misVaquitas().find((v) => v.naddr === link.naddr);
  let sk = null;
  for (const candidata of [link.admin, guardada?.sk]) {
    try {
      if (candidata && N.pubkeyDe(candidata) === dec.pubkey) {
        sk = candidata;
        break;
      }
    } catch {}
  }
  // El secreto de administración no se queda en la barra de direcciones.
  if (link.admin) history.replaceState(null, '', L.armarLink(BASE, { naddr: link.naddr, clave: link.clave }));

  const a = { ...link, admin: undefined, pubkey: dec.pubkey, d: dec.d, relays, sk, evento: null, datos: null, aportes: new Map(), pendientes: [], info: null };
  app.actual = a;
  cargando('Buscando la vaquita en los relays de Nostr…');

  if (app.semilla?.naddr === link.naddr) {
    a.evento = app.semilla.evento;
    a.datos = app.semilla.datos;
    app.semilla = null;
    render();
  }

  const noEncontrada = () => {
    if (!a.datos && app.actual === a) cargando('No encontramos esta vaquita. Puede que el link esté mal copiado o que los relays no respondan.', { reintentar: true });
  };
  a.cerrar = N.escuchar({
    pubkey: a.pubkey,
    d: a.d,
    relays,
    onVaquita: (ev) => recibirVaquita(a, ev),
    onRecibo: (ev) => recibirRecibo(a, ev),
    onListo: () => setTimeout(noEncontrada, 2000),
  });
  a.timeout = setTimeout(noEncontrada, 15000);
}

async function recibirVaquita(a, ev) {
  if (ev.pubkey !== a.pubkey || ev.tags.find((t) => t[0] === 'd')?.[1] !== a.d) return;
  if (a.evento && ev.created_at <= a.evento.created_at) return;
  let datos;
  try {
    datos = await descifrar(ev.content, a.clave);
  } catch {
    if (!a.datos && app.actual === a) cargando('No pudimos abrir esta vaquita: la clave del link no corresponde. Pedile el link de nuevo a quien organiza.', { reintentar: false });
    return;
  }
  if (app.actual !== a || (a.evento && ev.created_at <= a.evento.created_at)) return;
  a.evento = ev;
  a.datos = datos;
  for (const r of a.pendientes.splice(0)) recibirRecibo(a, r);
  recordar({ naddr: a.naddr, clave: a.clave, titulo: datos.titulo, sk: a.sk });
  render();
}

function recibirRecibo(a, ev) {
  if (app.actual !== a) return;
  if (!a.datos) return void a.pendientes.push(ev);
  const aporte = validarRecibo(ev, { nostrPubkey: a.datos.nostrPubkey, vaquitaPk: a.pubkey });
  if (!aporte || a.aportes.has(aporte.bolt11)) return;
  a.aportes.set(aporte.bolt11, aporte);
  if (app.pago && app.pago.pr === aporte.bolt11) pagoConfirmado();
  programarRender();
}

let renderPendiente = false;
function programarRender() {
  if (renderPendiente) return;
  renderPendiente = true;
  requestAnimationFrame(() => {
    renderPendiente = false;
    render();
  });
}

const ETIQUETAS = { pagado: 'Pagó ✓', manual: 'Pagó (marcado a mano)', parcial: 'Pagó una parte', pendiente: 'Pendiente' };

function filaPersona(p, d, admin) {
  const monto = d.moneda === 'ARS' && p.pesos != null ? `${L.formatoPesos(p.pesos)} · ${L.formatoSats(p.sats)}` : L.formatoSats(p.sats);
  const listo = p.estado === 'pagado' || p.estado === 'manual';
  const chip = el('span', { class: `chip chip-${p.estado}` }, p.estado === 'parcial' ? `Faltan ${L.formatoSats(p.falta)}` : ETIQUETAS[p.estado]);
  return el(
    'li',
    { class: 'persona', dataset: { id: p.id } },
    el('div', {}, el('div', { class: 'persona-nombre' }, p.nombre), el('div', { class: 'persona-monto' }, monto)),
    el(
      'div',
      { class: 'persona-acciones' },
      chip,
      !listo && el('button', { type: 'button', class: 'btn btn-primary btn-chico', dataset: { accion: 'pagar', id: p.id }, ariaLabel: `Pagar la parte de ${p.nombre}` }, 'Pagar'),
      admin && p.estado !== 'pagado' && el('button', { type: 'button', class: 'link-admin-accion', dataset: { accion: p.estado === 'manual' ? 'desmarcar' : 'marcar', id: p.id } }, p.estado === 'manual' ? 'Desmarcar' : 'Marcar pagado'),
    ),
  );
}

function render() {
  const a = app.actual;
  if (!a?.datos) return;
  clearTimeout(a.timeout);
  const d = a.datos;
  const e = L.estadoVaquita(d, [...a.aportes.values()]);
  $('cargando').hidden = true;
  $('contenido').hidden = false;
  document.title = `${d.titulo} — Vaquita ⚡`;

  $('v-titulo').textContent = d.titulo;
  if (d.moneda === 'ARS') {
    $('v-total').textContent = L.formatoPesos(d.total);
    $('v-total-sats').textContent = `≈ ${L.formatoSats(e.totalSats)}`;
  } else {
    $('v-total').textContent = L.formatoSats(e.totalSats);
    $('v-total-sats').textContent = '';
  }
  const pct = Math.round(e.progreso * 100);
  $('v-barra-relleno').style.width = `${pct}%`;
  $('v-barra').setAttribute('aria-valuenow', String(pct));
  $('v-progreso').textContent = `${L.formatoSats(e.saldadoSats)} de ${L.formatoSats(e.totalSats)} · ${e.listas} de ${e.personas.length} personas listas`;
  $('v-completa').hidden = !e.completa;

  $('personas').replaceChildren(...e.personas.map((p) => filaPersona(p, d, Boolean(a.sk))));
  $('v-sin-asignar').hidden = !e.sinAsignar;
  $('v-sin-asignar').textContent = e.sinAsignar ? `Además entraron ${L.formatoSats(e.sinAsignar)} sin persona asignada.` : '';
  $('v-detalle').textContent =
    `Los pagos van directo a ${d.direccion}.` + (d.precio ? ` Cotización usada: 1 BTC = ${L.formatoPesos(d.precio.arsPorBtc)} (${d.precio.fuente}, ${fechaCorta(d.precio.fecha)}).` : '');

  const link = L.armarLink(BASE, { naddr: a.naddr, clave: a.clave });
  $('link-compartir').value = link;
  $('btn-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(L.textoCompartir(d, link))}`;
  if (!$('qr-link').hidden) $('qr-link').replaceChildren(svgQR(link, { etiqueta: 'QR del link de la vaquita' }));

  $('panel-admin').hidden = !a.sk;
  if (a.sk) {
    const faltan = e.personas.filter((p) => p.estado === 'pendiente' || p.estado === 'parcial');
    const btnRecordar = $('btn-recordar');
    btnRecordar.hidden = faltan.length === 0;
    btnRecordar.href = `https://wa.me/?text=${encodeURIComponent(L.textoRecordatorio(d, faltan, link))}`;
    $('link-admin').value = L.armarLink(BASE, { naddr: a.naddr, clave: a.clave, admin: a.sk });
  }

  const nombres = new Map(d.personas.map((p) => [p.id, p.nombre]));
  const aportes = [...a.aportes.values()].sort((x, y) => y.fecha - x.fecha);
  $('actividad-vacia').hidden = aportes.length > 0;
  $('actividad').replaceChildren(
    ...aportes.map((ap) =>
      el(
        'li',
        {},
        el('span', {}, `${nombres.get(ap.persona) || 'Sin asignar'} · `, el('b', {}, L.formatoSats(ap.sats)), ` · ${L.haceCuanto(ap.fecha)}`),
        el('a', { href: N.linkComprobante(ap.id, a.relays), target: '_blank', rel: 'noopener' }, 'Ver comprobante'),
      ),
    ),
  );
}

async function marcarManual(id, valor) {
  const a = app.actual;
  if (!a?.sk || !a.datos) return;
  const datos = { ...a.datos, manuales: { ...a.datos.manuales } };
  if (valor) datos.manuales[id] = true;
  else delete datos.manuales[id];
  try {
    const ev = await N.publicarVaquita({ sk: a.sk, d: a.d, contenido: await cifrar(datos, a.clave), relays: a.relays, anterior: a.evento?.created_at || 0 });
    if (app.actual !== a) return;
    a.evento = ev;
    a.datos = datos;
    render();
    toast(valor ? 'Marcado como pagado' : 'Marca quitada');
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- Pago ---------- */

const dlg = $('dlg-pago');

function estadoPago(texto, clase = '') {
  const e = $('pago-estado');
  e.textContent = texto;
  e.className = `pago-estado ${clase}`;
}

async function obtenerInfo(a) {
  a.info ??= await resolverDireccion(a.datos.direccion);
  return a.info;
}

/** Abre el diálogo de pago en estado "generando factura". */
function abrirDialogo({ id, titulo, sats, pesos, listo, nota }) {
  app.pago = { id, pr: null };
  $('pago-titulo').textContent = titulo;
  $('pago-sats').textContent = L.formatoSats(sats);
  $('pago-pesos').textContent = pesos != null ? `≈ ${L.formatoPesos(pesos)}` : '';
  $('pago-listo-titulo').textContent = listo;
  $('pago-listo-nota').textContent = nota;
  $('pago-qr').replaceChildren();
  $('pago-qr').hidden = true;
  $('pago-cuerpo').hidden = false;
  $('pago-listo').hidden = true;
  for (const b of ['pago-abrir', 'pago-copiar']) $(b).hidden = true;
  $('pago-webln').hidden = true;
  estadoPago('Generando la factura…', 'esperando');
  if (!dlg.open) dlg.showModal();
}

/** Muestra la factura (QR, botón a la billetera, copiar, WebLN). */
function mostrarFactura(pr, espera) {
  app.pago.pr = pr;
  $('pago-qr').replaceChildren(svgQR(`lightning:${pr}`.toUpperCase(), { etiqueta: 'QR de la factura Lightning' }));
  $('pago-qr').hidden = false;
  $('pago-abrir').href = `lightning:${pr}`;
  $('pago-abrir').hidden = false;
  $('pago-copiar').hidden = false;
  $('pago-webln').hidden = !window.webln;
  estadoPago(espera, 'esperando');
}

async function pagar(id) {
  const a = app.actual;
  if (!a?.datos) return;
  const d = a.datos;
  const p = L.estadoVaquita(d, [...a.aportes.values()]).personas.find((x) => x.id === id);
  if (!p) return;
  const sats = p.estado === 'parcial' ? p.falta : p.sats;
  // La parte completa se muestra en los pesos que cargó quien organiza (sin el redondeo a sats).
  const pesos = p.estado !== 'parcial' && p.pesos != null ? p.pesos : d.precio ? L.satsAPesos(sats, d.precio.arsPorBtc) : null;
  abrirDialogo({ id, titulo: `Pagar la parte de ${p.nombre}`, sats, pesos, listo: '¡Pago recibido!', nota: 'Verificado con el comprobante que firmó la billetera de quien organiza.' });

  try {
    const info = await obtenerInfo(a);
    if (!info.allowsNostr || info.nostrPubkey !== d.nostrPubkey) {
      throw new Error('La billetera de quien organiza cambió su configuración y el pago no se podría verificar. Avisale.');
    }
    const { sk } = N.nuevaIdentidad();
    const plantilla = armarPedidoZap({ info, vaquitaPk: a.pubkey, coordenada: N.coordenada(a.pubkey, a.d), eventoId: a.evento.id, persona: id, sats, relays: a.relays.slice(0, 5) });
    const { pr } = await pedirFactura({ info, sats, pedido: N.firmar(plantilla, sk) });
    if (app.pago?.id !== id || !dlg.open) return;
    if (a.aportes.has(pr)) {
      app.pago.pr = pr;
      return pagoConfirmado();
    }
    mostrarFactura(pr, 'Esperando el pago… Escaneá el QR con tu billetera: se confirma solo.');
  } catch (e) {
    if (app.pago?.id === id) estadoPago(e.message || 'No pudimos generar la factura.', 'error');
  }
}

/* ---------- Propinas para el proyecto ---------- */

let cerrarPropina = null;
let infoPropinas = null;

async function propina(sats) {
  const id = `propina-${sats}`;
  abrirDialogo({
    id,
    titulo: 'Propina para Vaquita',
    sats,
    pesos: app.precio ? L.satsAPesos(sats, app.precio.arsPorBtc) : null,
    listo: '¡Gracias por la propina!',
    nota: 'Ayuda a mantener Vaquita gratis, sin publicidad y de código abierto.',
  });
  try {
    infoPropinas ??= await resolverDireccion(PROPINAS.direccion);
    const info = infoPropinas;
    const relays = relaysPorDefecto();
    const plantilla = armarPedidoZap({ info, vaquitaPk: PROPINAS.pubkey, persona: 'propina', sats, relays: relays.slice(0, 5), comentario: 'Propina para Vaquita' });
    const { pr } = await pedirFactura({ info, sats, pedido: N.firmar(plantilla, N.nuevaIdentidad().sk) });
    if (app.pago?.id !== id || !dlg.open) return;
    if (info.allowsNostr) {
      cerrarPropina?.();
      cerrarPropina = N.escucharRecibos({
        pubkey: PROPINAS.pubkey,
        relays,
        desde: Math.floor(Date.now() / 1000) - 120,
        onRecibo: (ev) => {
          const aporte = validarRecibo(ev, { nostrPubkey: info.nostrPubkey, vaquitaPk: PROPINAS.pubkey });
          if (aporte && app.pago?.pr === aporte.bolt11) pagoConfirmado();
        },
      });
    }
    mostrarFactura(pr, info.allowsNostr ? 'Esperando el pago… se confirma solo.' : 'Cuando pagues, podés cerrar esta ventana.');
  } catch (e) {
    if (app.pago?.id === id) estadoPago(e.message || 'No pudimos generar la factura.', 'error');
  }
}

function pagoConfirmado() {
  $('pago-cuerpo').hidden = true;
  $('pago-listo').hidden = false;
  app.pago = null;
}

async function pagarConWebln() {
  const pr = app.pago?.pr;
  if (!pr || !window.webln) return;
  try {
    await window.webln.enable();
    await window.webln.sendPayment(pr);
    estadoPago('Pago enviado. Esperando el comprobante…', 'esperando');
  } catch (e) {
    estadoPago(`La extensión no pudo pagar: ${e.message || e}`, 'error');
  }
}

/* ---------- Arranque ---------- */

function enrutar() {
  const link = L.leerLink(location.hash);
  if (link) return abrirVaquita(link);
  cerrarActual();
  mostrarVista('inicio');
  document.title = 'Vaquita ⚡ — Gastos compartidos en sats';
  renderMias();
}

form.addEventListener('submit', crear);
form.addEventListener('input', actualizarPrevia);
$('personas').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-accion]');
  if (!b) return;
  if (b.dataset.accion === 'pagar') pagar(b.dataset.id);
  else marcarManual(b.dataset.id, b.dataset.accion === 'marcar');
});
$('btn-copiar-link').addEventListener('click', () => copiar($('link-compartir').value, 'Link copiado'));
$('btn-copiar-admin').addEventListener('click', () => copiar($('link-admin').value, 'Link de administración copiado'));
$('btn-qr-link').addEventListener('click', (e) => {
  const qr = $('qr-link');
  qr.hidden = !qr.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!qr.hidden));
  e.currentTarget.textContent = qr.hidden ? 'Mostrar QR' : 'Ocultar QR';
  if (!qr.hidden) qr.replaceChildren(svgQR($('link-compartir').value, { etiqueta: 'QR del link de la vaquita' }));
});
$('btn-reintentar').addEventListener('click', enrutar);
$('pago-copiar').addEventListener('click', () => app.pago?.pr && copiar(app.pago.pr, 'Factura copiada'));
$('pago-webln').addEventListener('click', pagarConWebln);
$('pago-cerrar').addEventListener('click', () => dlg.close());
$('pago-ok').addEventListener('click', () => dlg.close());
dlg.addEventListener('close', () => {
  app.pago = null;
  cerrarPropina?.();
  cerrarPropina = null;
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-propina]');
  if (b) propina(Number(b.dataset.propina));
});
window.addEventListener('hashchange', enrutar);

const red = () => ($('red').hidden = navigator.onLine);
window.addEventListener('online', red);
window.addEventListener('offline', red);
red();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

enrutar();
cargarPrecio();
