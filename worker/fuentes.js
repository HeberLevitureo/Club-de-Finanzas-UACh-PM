// Club de Finanzas UACh — descarga de cotizaciones para la barra de indicadores.
// Lo usan el Worker de Cloudflare (worker/index.js) y la GitHub Action de respaldo
// (scripts/actualizar-indicadores.mjs), para que ambos entreguen exactamente lo mismo.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CABECERAS = { 'User-Agent': UA, Accept: 'application/json' };

// Para sumar un indicador basta agregar una línea con su símbolo de Yahoo Finance
// (y, si existe, su símbolo de CNBC como fuente de respaldo).
export const SIMBOLOS = [
  // MSCI IPSA: el mismo índice (y valor) que publica la Bolsa de Santiago
  { id: 'ipsa',    simbolo: 'MXIPSAGC.SN', nombre: 'MSCI IPSA', decimales: 2 },
  { id: 'sp500',   simbolo: '^GSPC',   cnbc: '.SPX',    nombre: 'S&P 500',      decimales: 2 },
  { id: 'nasdaq',  simbolo: '^IXIC',   cnbc: '.IXIC',   nombre: 'Nasdaq',       decimales: 2 },
  { id: 'dow',     simbolo: '^DJI',    cnbc: '.DJI',    nombre: 'Dow Jones',    decimales: 2 },
  { id: 'cobre',   simbolo: 'HG=F',    cnbc: '@HG.1',   nombre: 'Cobre',        decimales: 2, prefijo: 'US$ ', sufijo: '/lb' },
  { id: 'wti',     simbolo: 'CL=F',    cnbc: '@CL.1',   nombre: 'Petróleo WTI', decimales: 2, prefijo: 'US$ ' },
  { id: 'brent',   simbolo: 'BZ=F',    cnbc: '@LCO.1',  nombre: 'Brent',        decimales: 2, prefijo: 'US$ ' },
  { id: 'oro',     simbolo: 'GC=F',    cnbc: '@GC.1',   nombre: 'Oro',          decimales: 2, prefijo: 'US$ ' },
  { id: 'bitcoin', simbolo: 'BTC-USD', cnbc: 'BTC.CM=', nombre: 'Bitcoin',      decimales: 0, prefijo: 'US$ ' },
];

const redondear = (x) => Math.round(x * 100) / 100;

// Convierte la respuesta de Yahoo en { valor, variacion, fecha }.
export function interpretar(json) {
  const r = json?.chart?.result?.[0];
  const meta = r?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('respuesta sin precio');

  const offset = meta.gmtoffset || 0;
  const dia = (t) => Math.floor((t + offset) / 86400);
  const cierres = (r.timestamp || [])
    .map((t, i) => ({ t, c: r.indicators?.quote?.[0]?.close?.[i] }))
    .filter((x) => typeof x.c === 'number');

  // Cierre anterior = último cierre de un día distinto al del precio actual.
  const hoy = dia(meta.regularMarketTime);
  const previos = cierres.filter((x) => dia(x.t) < hoy);
  const anterior = previos.length ? previos[previos.length - 1].c : null;

  const valor = meta.regularMarketPrice;
  const item = { valor, fecha: new Date(meta.regularMarketTime * 1000).toISOString() };
  if (anterior) item.variacion = redondear(((valor - anterior) / anterior) * 100);
  // Algunos índices no traen historial diario: se usa la variación que informa la propia fuente.
  else if (typeof meta.regularMarketChangePercent === 'number') item.variacion = redondear(meta.regularMarketChangePercent);
  return item;
}

async function consultarYahoo(simbolo) {
  let ultimoError;
  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=10d&interval=1d`;
      const res = await fetch(url, { headers: CABECERAS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return interpretar(await res.json());
    } catch (e) {
      ultimoError = e;
    }
  }
  throw ultimoError;
}

// Fuente de respaldo: cotizaciones de CNBC (una sola consulta para todos los símbolos).
async function consultarCnbc(simbolos) {
  const url = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' +
    simbolos.map(encodeURIComponent).join('%7C') + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json';
  const res = await fetch(url, { headers: CABECERAS });
  if (!res.ok) throw new Error(`CNBC HTTP ${res.status}`);
  const lista = (await res.json())?.FormattedQuoteResult?.FormattedQuote || [];
  const num = (t) => Number(String(t ?? '').replace(/,/g, ''));
  const mapa = {};
  for (const q of lista) {
    const valor = num(q.last), anterior = num(q.previous_day_closing), fecha = new Date(q.last_time);
    if (!q.symbol || !(valor > 0) || isNaN(fecha)) continue;
    const item = { valor, fecha: fecha.toISOString() };
    if (anterior > 0) item.variacion = redondear(((valor - anterior) / anterior) * 100);
    mapa[q.symbol] = item;
  }
  return mapa;
}

// Descarga todos los indicadores. Devuelve { items, nuevos, avisos }.
// `leerAnteriores` (opcional) entrega los últimos items publicados: si un símbolo no se
// pudo actualizar se conserva su dato anterior con la fecha original, nunca uno inventado.
export async function obtenerIndicadores({ leerAnteriores, simularFallaYahoo = false } = {}) {
  const avisos = [];
  const yahoo = await Promise.all(SIMBOLOS.map((s) =>
    (simularFallaYahoo ? Promise.reject(new Error('falla simulada')) : consultarYahoo(s.simbolo))
      .catch((e) => { avisos.push(`Yahoo Finance falló para ${s.simbolo}: ${e.message}`); return null; })));

  let cnbc = {};
  const faltanConRespaldo = SIMBOLOS.filter((s, i) => !yahoo[i] && s.cnbc);
  if (faltanConRespaldo.length) {
    cnbc = await consultarCnbc(faltanConRespaldo.map((s) => s.cnbc))
      .catch((e) => { avisos.push(`CNBC falló: ${e.message}`); return {}; });
  }

  let anteriores = null;
  const items = [];
  let nuevos = 0;
  for (let i = 0; i < SIMBOLOS.length; i++) {
    const s = SIMBOLOS[i];
    const base = { id: s.id, nombre: s.nombre, decimales: s.decimales, prefijo: s.prefijo, sufijo: s.sufijo };
    if (yahoo[i]) { items.push({ ...base, ...yahoo[i], fuente: 'Yahoo Finance' }); nuevos++; continue; }
    if (s.cnbc && cnbc[s.cnbc]) { items.push({ ...base, ...cnbc[s.cnbc], fuente: 'CNBC' }); nuevos++; continue; }
    if (anteriores === null) anteriores = leerAnteriores ? await leerAnteriores().catch(() => []) : [];
    const previo = anteriores.find((a) => a && a.id === s.id);
    if (previo) items.push(previo);
    avisos.push(`Sin dato nuevo para ${s.simbolo}${previo ? ' (se mantiene el anterior)' : ''}`);
  }
  return { items, nuevos, avisos };
}
