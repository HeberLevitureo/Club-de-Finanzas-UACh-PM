// Club de Finanzas UACh — genera indicadores.json para la barra de indicadores.
// Lo ejecuta la GitHub Action .github/workflows/indicadores.yml (Node 20, sin dependencias).
// Uso: node scripts/actualizar-indicadores.mjs <carpeta-de-salida>

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SALIDA = process.argv[2] || 'salida';
const PUBLICADO = `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY || 'HeberLevitureo/Club-de-Finanzas-UACh-PM'}/datos/indicadores.json`;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Para sumar un indicador basta agregar una línea con su símbolo de Yahoo Finance.
const SIMBOLOS = [
  { id: 'ipsa',    simbolo: '^IPSA',   nombre: 'IPSA',         decimales: 2 },
  { id: 'sp500',   simbolo: '^GSPC',   nombre: 'S&P 500',      decimales: 2 },
  { id: 'nasdaq',  simbolo: '^IXIC',   nombre: 'Nasdaq',       decimales: 2 },
  { id: 'dow',     simbolo: '^DJI',    nombre: 'Dow Jones',    decimales: 2 },
  { id: 'cobre',   simbolo: 'HG=F',    nombre: 'Cobre',        decimales: 2, prefijo: 'US$ ', sufijo: '/lb' },
  { id: 'wti',     simbolo: 'CL=F',    nombre: 'Petróleo WTI', decimales: 2, prefijo: 'US$ ' },
  { id: 'brent',   simbolo: 'BZ=F',    nombre: 'Brent',        decimales: 2, prefijo: 'US$ ' },
  { id: 'oro',     simbolo: 'GC=F',    nombre: 'Oro',          decimales: 2, prefijo: 'US$ ' },
  { id: 'bitcoin', simbolo: 'BTC-USD', nombre: 'Bitcoin',      decimales: 0, prefijo: 'US$ ' },
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

  for (const s of SIMBOLOS) {
    const base = { id: s.id, nombre: s.nombre, decimales: s.decimales, prefijo: s.prefijo, sufijo: s.sufijo };
    try {
      items.push({ ...base, ...(await consultar(s.simbolo)) });
      nuevos++;
      console.log(`ok     ${s.simbolo}`);
    } catch (e) {
      // Si la fuente falla se conserva el último dato publicado (con su fecha original).
      const previo = anteriores.find((a) => a.id === s.id);
      if (previo) items.push(previo);
      console.warn(`FALLÓ  ${s.simbolo}: ${e.message}${previo ? ' — se mantiene el dato anterior' : ''}`);
    }
  }

  if (!nuevos) {
    console.error('Ningún indicador se pudo actualizar; no se publica nada.');
    process.exit(1);
  }

  await mkdir(SALIDA, { recursive: true });
  await writeFile(
    join(SALIDA, 'indicadores.json'),
    JSON.stringify({ actualizado: new Date().toISOString(), fuente: 'Yahoo Finance', items }, null, 2) + '\n',
  );
  console.log(`indicadores.json listo: ${nuevos} actualizados de ${SIMBOLOS.length}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
