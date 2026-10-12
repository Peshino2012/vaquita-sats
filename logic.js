// Lógica pura de Vaquita: montos, conversión pesos ↔ sats, estado de pagos,
// links y textos. Sin DOM ni red, para poder testearla con node --test.

export const MAX_PARTICIPANTES = 40;
export const MAX_TITULO = 80;
export const MAX_NOMBRE = 40;

/** Lee montos escritos a la argentina: "30.000", "1.234,50", "$ 2500". */
export function leerMonto(texto) {
  if (typeof texto !== 'string') return NaN;
  let t = texto.trim().replace(/\s|\$|sats?/gi, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Reparte un total entre n personas en unidades enteras (centavos o sats),
 * sin perder ni inventar nada: las primeras personas absorben el resto.
 */
export function repartir(total, n) {
  if (!Number.isInteger(total) || total < 0) throw new RangeError('total debe ser un entero >= 0');
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n debe ser un entero >= 1');
  const base = Math.floor(total / n);
  const resto = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}

/** Pesos → sats al precio dado (pesos por 1 BTC). Redondea hacia arriba: nadie paga de menos. */
export function pesosASats(pesos, arsPorBtc) {
  if (!(pesos >= 0) || !(arsPorBtc > 0)) return NaN;
  return Math.ceil(Math.round((pesos / arsPorBtc) * 1e8 * 1000) / 1000);
}

export function satsAPesos(sats, arsPorBtc) {
  if (!(sats >= 0) || !(arsPorBtc > 0)) return NaN;
  return (sats / 1e8) * arsPorBtc;
}

const fmtPesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPesosEnteros = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtEntero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** "$ 10.000" para montos redondos y "$ 1.234,50" con centavos. */
export const formatoPesos = (n) => {
  if (!Number.isFinite(n)) return '—';
  const redondeado = Math.round(n * 100) / 100;
  return (Number.isInteger(redondeado) ? fmtPesosEnteros : fmtPesos).format(redondeado);
};
export const formatoSats = (n) => (Number.isFinite(n) ? `${fmtEntero.format(n)} sats` : '—');
export const formatoNumero = (n) => (Number.isFinite(n) ? fmtEntero.format(n) : '—');

/** usuario@dominio.com, como lo define LUD-16 (minúsculas, dígitos, -_.+). */
export function esLightningAddress(texto) {
  return typeof texto === 'string' && /^[a-z0-9\-_.+]+@([a-z0-9-]+\.)+[a-z]{2,}$/.test(texto.trim().toLowerCase());
}

/** Separa la lista de nombres que escribe el organizador (uno por línea o por coma). */
export function leerNombres(texto) {
  return String(texto || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/**
 * Valida el formulario de "Nueva vaquita" y arma los datos que se cifran y
 * publican. Devuelve { ok: true, datos } o { ok: false, errores: {campo: msg} }.
 * moneda: 'ARS' (total en pesos, se convierte a sats) o 'SAT' (total en sats).
 */
export function armarVaquita({ titulo, total, moneda = 'ARS', nombres, direccion, arsPorBtc, fuentePrecio, yoPague = false, ahora = Date.now() }) {
  const errores = {};
  const t = String(titulo || '').trim().replace(/\s+/g, ' ');
  if (!t) errores.titulo = 'Poné un nombre, por ejemplo "Asado del sábado".';
  else if (t.length > MAX_TITULO) errores.titulo = `Máximo ${MAX_TITULO} caracteres.`;

  const lista = Array.isArray(nombres) ? nombres : leerNombres(nombres);
  if (lista.length < 2) errores.nombres = 'Agregá al menos 2 personas (incluyéndote).';
  else if (lista.length > MAX_PARTICIPANTES) errores.nombres = `Máximo ${MAX_PARTICIPANTES} personas.`;
  else if (lista.some((n) => n.length > MAX_NOMBRE)) errores.nombres = `Cada nombre puede tener hasta ${MAX_NOMBRE} caracteres.`;
  else if (new Set(lista.map((n) => n.toLowerCase())).size !== lista.length) errores.nombres = 'Hay nombres repetidos: agregales una inicial para distinguirlos.';

  const monto = typeof total === 'number' ? total : leerMonto(total);
  if (!(monto > 0)) errores.total = 'Escribí cuánto salió en total.';
  if (moneda !== 'ARS' && moneda !== 'SAT') errores.total = 'Moneda inválida.';
  if (moneda === 'ARS' && !(arsPorBtc > 0)) errores.total = 'No pudimos obtener la cotización del bitcoin. Probá de nuevo en un rato o cargá el total en sats.';

  const dir = String(direccion || '').trim().toLowerCase();
  if (!esLightningAddress(dir)) errores.direccion = 'Tiene que ser una Lightning Address, como vos@blink.sv.';

  if (Object.keys(errores).length) return { ok: false, errores };

  let personas;
  if (moneda === 'ARS') {
    const centavos = repartir(Math.round(monto * 100), lista.length);
    personas = lista.map((nombre, i) => ({ id: `p${i + 1}`, nombre, pesos: centavos[i] / 100, sats: pesosASats(centavos[i] / 100, arsPorBtc) }));
  } else {
    const sats = repartir(Math.round(monto), lista.length);
    personas = lista.map((nombre, i) => ({ id: `p${i + 1}`, nombre, pesos: null, sats: sats[i] }));
  }
  if (personas.some((p) => p.sats < 1)) return { ok: false, errores: { total: 'El monto por persona es menor a 1 sat.' } };

  return {
    ok: true,
    datos: {
      v: 1,
      titulo: t,
      moneda,
      total: monto,
      precio: moneda === 'ARS' ? { arsPorBtc, fuente: fuentePrecio || '', fecha: new Date(ahora).toISOString() } : null,
      direccion: dir,
      personas,
      // El organizador suele haber pagado el gasto: su parte arranca saldada.
      manuales: yoPague ? { p1: true } : {},
      creada: new Date(ahora).toISOString(),
    },
  };
}

/**
 * Cruza los datos de la vaquita con los aportes verificados (zaps válidos)
 * y las marcas manuales del organizador. Un aporte sin persona asignada (o
 * con una que no existe) cuenta para el total pero queda "sin asignar".
 */
export function estadoVaquita(datos, aportes = []) {
  const porPersona = new Map(datos.personas.map((p) => [p.id, 0]));
  let sinAsignar = 0;
  const vistos = new Set();
  for (const a of aportes) {
    const clave = a.bolt11 || a.id;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    if (porPersona.has(a.persona)) porPersona.set(a.persona, porPersona.get(a.persona) + a.sats);
    else sinAsignar += a.sats;
  }
  const manuales = datos.manuales || {};
  const personas = datos.personas.map((p) => {
    const recibido = porPersona.get(p.id);
    let estado = 'pendiente';
    if (recibido >= p.sats) estado = 'pagado';
    else if (manuales[p.id]) estado = 'manual';
    else if (recibido > 0) estado = 'parcial';
    return { ...p, recibido, falta: Math.max(0, p.sats - recibido), estado };
  });
  const totalSats = datos.personas.reduce((s, p) => s + p.sats, 0);
  const saldadoSats = personas.reduce((s, p) => s + (p.estado === 'manual' ? p.sats : Math.min(p.recibido, p.sats)), 0);
  const recibidoSats = personas.reduce((s, p) => s + p.recibido, 0) + sinAsignar;
  const listas = personas.filter((p) => p.estado === 'pagado' || p.estado === 'manual').length;
  return {
    personas,
    totalSats,
    recibidoSats,
    saldadoSats,
    sinAsignar,
    listas,
    completa: listas === personas.length,
    progreso: totalSats ? Math.min(1, saldadoSats / totalSats) : 0,
  };
}

/** Link para compartir. Todo va en el fragmento (#), que el navegador nunca manda a ningún servidor. */
export function armarLink(base, { naddr, clave, admin }) {
  const params = new URLSearchParams({ v: naddr, k: clave });
  if (admin) params.set('a', admin);
  return `${base.split('#')[0]}#${params.toString()}`;
}

export function leerLink(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const naddr = p.get('v');
  const clave = p.get('k');
  if (!naddr || !clave || !/^naddr1[a-z0-9]+$/.test(naddr) || !/^[A-Za-z0-9_-]{43}$/.test(clave)) return null;
  const admin = p.get('a');
  return { naddr, clave, admin: admin && /^[0-9a-f]{64}$/.test(admin) ? admin : null };
}

/** Mensaje para mandar por WhatsApp con el link de la vaquita. */
export function textoCompartir(datos, link) {
  const unaParte = datos.personas[0];
  const monto = datos.moneda === 'ARS' ? `${formatoPesos(unaParte.pesos)} (${formatoSats(unaParte.sats)})` : formatoSats(unaParte.sats);
  return `🐄⚡ Vaquita "${datos.titulo}": son ${monto} por persona. Pagá tu parte en sats desde acá y queda registrado al instante: ${link}`;
}

export function textoRecordatorio(datos, pendientes, link) {
  const nombres = pendientes.map((p) => p.nombre).join(', ');
  return `🐄⚡ Recordatorio de la vaquita "${datos.titulo}": falta que paguen ${nombres}. Se paga en sats desde acá: ${link}`;
}

/** "hace 5 min", "hace 2 h"... */
export function haceCuanto(iso, ahora = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.round((ahora - t) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}
