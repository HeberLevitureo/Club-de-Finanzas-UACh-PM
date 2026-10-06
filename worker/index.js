// Club de Finanzas UACh — Worker de Cloudflare.
// El sitio es estático: todo se sirve desde los archivos del repositorio, salvo
// /api/indicadores, que entrega las cotizaciones de mercado para la barra de indicadores.
// Los datos se descargan cuando alguien visita el sitio y se guardan 10 minutos,
// así que no dependen de ninguna tarea programada.

import { obtenerIndicadores } from './fuentes.js';

const MINUTOS_CACHE = 10;
const RESPALDO_GITHUB = 'https://raw.githubusercontent.com/HeberLevitureo/Club-de-Finanzas-UACh-PM/datos/indicadores.json';

let memoria = null; // { hasta, cuerpo } — copia en memoria mientras el Worker siga activo

async function leerRespaldo() {
  const res = await fetch(RESPALDO_GITHUB);
  if (!res.ok) throw new Error(`respaldo HTTP ${res.status}`);
  return res.json();
}

function responder(cuerpo, segundos, estado = 200) {
  return new Response(cuerpo, {
    status: estado,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': segundos ? `public, max-age=${segundos}` : 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function indicadores(request, ctx) {
  const ttl = MINUTOS_CACHE * 60;
  if (memoria && memoria.hasta > Date.now()) return responder(memoria.cuerpo, 60);

  const clave = new Request(new URL('/api/indicadores', request.url).toString());
  const guardada = await caches.default.match(clave);
  if (guardada) return guardada;

  const { items, nuevos, avisos } = await obtenerIndicadores({
    leerAnteriores: async () => (await leerRespaldo()).items || [],
  });
  avisos.forEach((a) => console.warn(a));

  if (nuevos) {
    const cuerpo = JSON.stringify({ actualizado: new Date().toISOString(), origen: 'cloudflare', items });
    memoria = { hasta: Date.now() + ttl * 1000, cuerpo };
    ctx.waitUntil(caches.default.put(clave, responder(cuerpo, ttl)));
    return responder(cuerpo, 60);
  }

  // Ninguna fuente respondió: se entrega el último archivo publicado por la GitHub Action.
  try {
    const respaldo = await leerRespaldo();
    return responder(JSON.stringify({ ...respaldo, origen: 'respaldo-github' }), 60);
  } catch (e) {
    console.error('Sin datos de mercado:', e.message);
    return responder(JSON.stringify({ error: 'sin datos' }), 0, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/indicadores') return indicadores(request, ctx);
    return env.ASSETS.fetch(request);
  },
};
