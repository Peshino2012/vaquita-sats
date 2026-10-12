// Relay Nostr mínimo (NIP-01) en memoria, para tests y para desarrollo local.
import { WebSocketServer } from 'ws';
import { matchFilters, verifyEvent } from '../vendor/nostr.js';

const tagD = (ev) => ev.tags.find((t) => t[0] === 'd')?.[1] ?? '';
const esDireccionable = (ev) => ev.kind >= 30000 && ev.kind < 40000;

export function iniciarRelay({ port = 7777, host = '127.0.0.1' } = {}) {
  const eventos = [];
  const subs = new Map();
  const wss = new WebSocketServer({ port, host });
  const enviar = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  wss.on('connection', (ws) => {
    subs.set(ws, new Map());
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return enviar(ws, ['NOTICE', 'invalid: json']);
      }
      const [tipo, ...resto] = Array.isArray(msg) ? msg : [];
      if (tipo === 'EVENT') {
        const ev = resto[0];
        if (!ev || !verifyEvent(ev)) return enviar(ws, ['OK', ev?.id ?? '', false, 'invalid: bad signature']);
        if (esDireccionable(ev)) {
          const i = eventos.findIndex((e) => e.kind === ev.kind && e.pubkey === ev.pubkey && tagD(e) === tagD(ev));
          if (i >= 0 && eventos[i].created_at >= ev.created_at) return enviar(ws, ['OK', ev.id, true, 'duplicate: have newer']);
          if (i >= 0) eventos.splice(i, 1);
        }
        if (!eventos.some((e) => e.id === ev.id)) eventos.push(ev);
        enviar(ws, ['OK', ev.id, true, '']);
        for (const [cliente, m] of subs) for (const [id, filtros] of m) if (matchFilters(filtros, ev)) enviar(cliente, ['EVENT', id, ev]);
      } else if (tipo === 'REQ') {
        const [id, ...filtros] = resto;
        subs.get(ws).set(id, filtros);
        for (const e of eventos.filter((x) => matchFilters(filtros, x)).sort((a, b) => b.created_at - a.created_at)) enviar(ws, ['EVENT', id, e]);
        enviar(ws, ['EOSE', id]);
      } else if (tipo === 'CLOSE') {
        subs.get(ws)?.delete(resto[0]);
      }
    });
    ws.on('close', () => subs.delete(ws));
  });

  return { eventos, cerrar: () => new Promise((r) => wss.close(r)) };
}

/** Publica un evento en el relay (desde Node) y espera la confirmación. */
export function publicarEn(url, evento) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', evento]));
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d[0] === 'OK' && d[1] === evento.id) {
        ws.close();
        d[2] ? resolve() : reject(new Error(d[3]));
      }
    };
    ws.onerror = () => reject(new Error(`no se pudo conectar a ${url}`));
  });
}
