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

// Dominio oficial del club. Cualquier otra dirección (workers.dev, www) redirige aquí
// con 301, para que los buscadores indexen un solo sitio y no contenido duplicado.
const DOMINIO_OFICIAL = 'clubdefinanzasuach.cl';

// Cabeceras de seguridad para todas las páginas y archivos del sitio.
// La CSP va en modo "solo reportar" (Report-Only): no bloquea nada, solo avisa en la consola
// del navegador qué rompería. Cuando no aparezcan avisos, se puede cambiar a Content-Security-Policy.
const CABECERAS_SEGURIDAD = {
  'Strict-Transport-Security': 'max-age=15552000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy-Report-Only': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; '),
};

// Imágenes, CSS y JS cambian poco y sus nombres no llevan versión: un día en el navegador y,
// pasado ese tiempo, siguen sirviéndose mientras se revalidan en segundo plano.
// Las páginas HTML se dejan como las entrega Cloudflare (siempre revalidadas).
const ESTATICOS = /\.(?:png|jpe?g|webp|avif|svg|ico|css|js|woff2?)$/i;

// URLs siempre con ".html" (es la forma que declaran canonical y sitemap).
// Cloudflare, por defecto, responde 307 de /pagina.html a /pagina. Para evitarlo, /pagina.html
// se sirve directo con 200 (pidiendo el archivo por dentro), y /pagina, si es una página
// del sitio, redirige con 301 a /pagina.html.
async function servirArchivo(request, env) {
  const url = new URL(request.url);
  let solicitud = request;
  if (url.pathname.endsWith('.html')) {
    const interna = new URL(url);
    interna.pathname = url.pathname === '/index.html' ? '/' : url.pathname.slice(0, -'.html'.length);
    solicitud = new Request(interna, request);
  } else if (url.pathname !== '/' && !url.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    const prueba = await env.ASSETS.fetch(request);
    if (prueba.status === 200 && (prueba.headers.get('content-type') || '').includes('text/html')) {
      url.pathname += '.html';
      return Response.redirect(url.toString(), 301);
    }
    return agregarCabeceras(prueba);
  }
  return agregarCabeceras(await env.ASSETS.fetch(solicitud), url.pathname);
}

function agregarCabeceras(respuesta, pathname = '') {
  const resultado = new Response(respuesta.body, respuesta); // copia con cabeceras editables
  for (const [nombre, valor] of Object.entries(CABECERAS_SEGURIDAD)) resultado.headers.set(nombre, valor);
  if (respuesta.status === 200 && ESTATICOS.test(pathname)) {
    resultado.headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  }
  return resultado;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    // HTTP plano → HTTPS (301), para que nadie navegue el sitio sin cifrado.
    // (No aplica en desarrollo local: localhost solo habla HTTP.)
    const esLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'http:' && !esLocal) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    if (url.hostname.endsWith('.workers.dev') || url.hostname === `www.${DOMINIO_OFICIAL}`) {
      url.protocol = 'https:';
      url.hostname = DOMINIO_OFICIAL;
      url.port = '';
      return Response.redirect(url.toString(), 301);
    }
    if (pathname === '/api/indicadores') return indicadores(request, ctx);
    return servirArchivo(request, env);
  },
};
