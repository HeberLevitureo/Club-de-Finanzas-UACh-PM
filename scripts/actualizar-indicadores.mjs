// Club de Finanzas UACh — genera indicadores.json para la barra de indicadores.
// Lo ejecuta la GitHub Action .github/workflows/indicadores.yml (Node 20, sin dependencias).
// Uso: node scripts/actualizar-indicadores.mjs <carpeta-de-salida>

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SALIDA = process.argv[2] || 'salida';
const PUBLICADO = `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY || 'HeberLevitureo/Club-de-Finanzas-UACh-PM'}/datos/indicadores.json`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Para sumar un indicador basta agregar una línea con su símbolo de Yahoo Finance
// (y, si existe, su símbolo de CNBC como fuente de respaldo).
const SIMBOLOS = [
  { id: 'ipsa',    simbolo: '^IPSA',   nombre: 'IPSA',         decimales: 2 },
  { id: 'sp500',   simbolo: '^GSPC',   cnbc: '.SPX', nombre: 'S&P 500',      decimales: 2 },
  { id: 'nasdaq',  simbolo: '^IXIC',   cnbc: '.IXIC', nombre: 'Nasdaq',       decimales: 2 },
  { id: 'dow',     simbolo: '^DJI',    cnbc: '.DJI', nombre: 'Dow Jones',    decimales: 2 },
  { id: 'cobre',   simbolo: 'HG=F',    cnbc: '@HG.1', nombre: 'Cobre',        decimales: 2, prefijo: 'US$ ', sufijo: '/lb' },
  { id: 'wti',     simbolo: 'CL=F',    cnbc: '@CL.1', nombre: 'Petróleo WTI', decimales: 2, prefijo: 'US$ ' },
  { id: 'brent',   simbolo: 'BZ=F',    cnbc: '@LCO.1', nombre: 'Brent',        decimales: 2, prefijo: 'US$ ' },
  { id: 'oro',     simbolo: 'GC=F',    cnbc: '@GC.1', nombre: 'Oro',          decimales: 2, prefijo: 'US$ ' },
  { id: 'bitcoin', simbolo: 'BTC-USD', cnbc: 'BTC.CM=', nombre: 'Bitcoin',      decimales: 0, prefijo: 'US$ ' },
];

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
  if (anterior) item.variacion = Math.round(((valor - anterior) / anterior) * 10000) / 100;
  return item;
}

async function consultar(simbolo) {
  if (process.env.SIMULAR_FALLA_YAHOO) throw new Error('falla simulada');
  let ultimoError;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=10d&interval=1d`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return interpretar(await res.json());
    } catch (e) {
      ultimoError = e;
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  }
  throw ultimoError;
}

// Fuente de respaldo: cotizaciones de CNBC (una sola consulta para todos los símbolos).
async function consultarCnbc(simbolos) {
  const url = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=' +
    simbolos.map(encodeURIComponent).join('%7C') + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json';
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`CNBC HTTP ${res.status}`);
  const lista = (await res.json())?.FormattedQuoteResult?.FormattedQuote || [];
  const num = (t) => Number(String(t ?? '').replace(/,/g, ''));
  const mapa = {};
  for (const q of lista) {
    const valor = num(q.last), anterior = num(q.previous_day_closing), fecha = new Date(q.last_time);
    if (!q.symbol || !(valor > 0) || isNaN(fecha)) continue;
    const item = { valor, fecha: fecha.toISOString() };
    if (anterior > 0) item.variacion = Math.round(((valor - anterior) / anterior) * 10000) / 100;
    mapa[q.symbol] = item;
  }
  return mapa;
}

async function leerPublicado() {
  try {
    const res = await fetch(PUBLICADO);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch {
    return [];
  }
}

async function main() {
  const anteriores = await leerPublicado();
  const items = [];
  let nuevos = 0;

  let respaldo = null; // se consulta solo si Yahoo falla para algún símbolo

  for (const s of SIMBOLOS) {
    const base = { id: s.id, nombre: s.nombre, decimales: s.decimales, prefijo: s.prefijo, sufijo: s.sufijo };
    try {
      items.push({ ...base, ...(await consultar(s.simbolo)), fuente: 'Yahoo Finance' });
      nuevos++;
      console.log(`ok     ${s.simbolo} (Yahoo Finance)`);
      continue;
    } catch (e) {
      console.warn(`FALLÓ  ${s.simbolo} en Yahoo Finance: ${e.message}`);
    }
    if (s.cnbc) {
      if (respaldo === null) {
        respaldo = await consultarCnbc(SIMBOLOS.filter((x) => x.cnbc).map((x) => x.cnbc)).catch((e) => {
          console.warn(`FALLÓ  CNBC: ${e.message}`);
          return {};
        });
      }
      if (respaldo[s.cnbc]) {
        items.push({ ...base, ...respaldo[s.cnbc], fuente: 'CNBC' });
        nuevos++;
        console.log(`ok     ${s.simbolo} (CNBC)`);
        continue;
      }
    }
    // Sin dato nuevo se conserva el último publicado con su fecha original;
    // la barra lo deja de mostrar cuando supera los 5 días.
    const previo = anteriores.find((a) => a.id === s.id);
    if (previo) items.push(previo);
    console.warn(`SIN DATO NUEVO ${s.simbolo}${previo ? ' — se mantiene el anterior' : ''}`);
  }

  if (!nuevos) {
    console.error('Ningún indicador se pudo actualizar; no se publica nada.');
    process.exit(1);
  }

  await mkdir(SALIDA, { recursive: true });
  await writeFile(
    join(SALIDA, 'indicadores.json'),
    JSON.stringify({ actualizado: new Date().toISOString(), items }, null, 2) + '\n',
  );
  console.log(`indicadores.json listo: ${nuevos} actualizados de ${SIMBOLOS.length}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
