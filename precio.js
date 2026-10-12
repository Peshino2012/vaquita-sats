// Precio de referencia de 1 BTC en pesos. Se prueba una fuente por vez:
// todas responden con CORS abierto (verificado en vaquita/probe).

const mediana = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};

export const FUENTES = [
  { nombre: 'Yadio', url: 'https://api.yadio.io/convert/1/btc/ars', leer: (j) => Number(j.result) },
  { nombre: 'CriptoYa', url: 'https://criptoya.com/api/btc/ars/0.1', leer: (j) => mediana(Object.values(j).map((x) => Number(x?.ask))) },
  { nombre: 'CoinGecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=ars', leer: (j) => Number(j.bitcoin?.ars) },
];

/** Devuelve { arsPorBtc, fuente } o tira Error si ninguna fuente responde algo razonable. */
export async function precioBtcArs(fetchImpl = fetch) {
  for (const f of FUENTES) {
    try {
      const r = await fetchImpl(f.url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const valor = f.leer(await r.json());
      // Cota amplia: descarta respuestas rotas sin depender de la cotización del día.
      if (valor > 1e6 && valor < 1e13) return { arsPorBtc: Math.round(valor), fuente: f.nombre };
    } catch {}
  }
  throw new Error('No pudimos obtener la cotización del bitcoin.');
}
