/* ============================================================
   Club de Finanzas UACh — Barra de indicadores financieros
   Se inserta sola debajo del <header> de cualquier página que
   cargue este archivo con una etiqueta script (src="indicadores.js", defer).

   Fuentes:
   - UF, dólar observado, euro, UTM, TPM  -> mindicador.cl (en el navegador)
   - IPSA, S&P 500, Nasdaq, Dow Jones, petróleo, cobre, oro, bitcoin
     -> /api/indicadores (Worker de Cloudflare, worker/index.js), que los
        descarga de Yahoo Finance con CNBC de respaldo. Si no responde, se
        usa indicadores.json de la rama "datos" (GitHub Action).
   ============================================================ */
(function () {
  'use strict';

  var CONFIG = {
    mercadosUrl: '/api/indicadores',   // Worker de Cloudflare del propio sitio
    respaldoUrl: 'https://raw.githubusercontent.com/HeberLevitureo/Club-de-Finanzas-UACh-PM/datos/indicadores.json',
    chileUrl: 'https://mindicador.cl/api',
    fijo: false,          // true = la barra queda pegada al menú al hacer scroll
    refrescoMin: 15,      // cada cuántos minutos vuelve a consultar los datos
    pxPorSegundo: 45,     // velocidad de la rotación
    orden: ['uf', 'dolar', 'euro', 'ipsa', 'sp500', 'nasdaq', 'dow', 'cobre', 'wti', 'brent', 'oro', 'bitcoin', 'tpm', 'utm']
  };

  // Indicadores que se leen de mindicador.cl
  var CHILE = [
    { id: 'uf',    clave: 'uf',          nombre: 'UF',    prefijo: '$ ', decimales: 2 },
    { id: 'dolar', clave: 'dolar',       nombre: 'Dólar', prefijo: '$ ', decimales: 2 },
    { id: 'euro',  clave: 'euro',        nombre: 'Euro',  prefijo: '$ ', decimales: 2 },
    { id: 'tpm',   clave: 'tpm',         nombre: 'TPM',   sufijo: '%',   decimales: 2 },
    { id: 'utm',   clave: 'utm',         nombre: 'UTM',   prefijo: '$ ', decimales: 0 },
    // Respaldo: solo se usa si el cobre no viene en indicadores.json
    { id: 'cobre', clave: 'libra_cobre', nombre: 'Cobre', prefijo: 'US$ ', sufijo: '/lb', decimales: 2, respaldo: true }
  ];

  var CACHE_KEY = 'cfu-indicadores-v1';
  var CSS = [
    '.cfu-tk{background:#080D19;color:#E2E8F0;border-bottom:1px solid #1A2740;font-family:"Plus Jakarta Sans",system-ui,sans-serif;font-size:12.5px;line-height:1;display:flex;align-items:stretch;overflow:hidden;min-height:38px}',
    '.cfu-tk-tag{flex:none;display:flex;align-items:center;gap:8px;padding:0 16px 0 24px;background:#0C1424;color:#B7C3D9;font-weight:700;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;border-right:1px solid #1A2740}',
    '.cfu-tk-tag::before{content:"";width:6px;height:6px;border-radius:50%;background:#34D399}',
    '.cfu-tk-view{flex:1;min-width:0;overflow:hidden}',
    '.cfu-tk-track{display:flex;width:max-content;animation:cfu-move var(--cfu-d,60s) linear infinite}',
    '.cfu-tk:hover .cfu-tk-track{animation-play-state:paused}',
    '.cfu-tk-group{display:flex;flex:none}',
    '.cfu-i{display:flex;align-items:baseline;gap:8px;padding:12px 22px;white-space:nowrap;border-right:1px solid rgba(143,160,190,.16)}',
    '.cfu-n{font-weight:700;color:#8FA0BE;letter-spacing:.05em;text-transform:uppercase;font-size:11px}',
    '.cfu-v,.cfu-c{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;font-weight:500}',
    '.cfu-v{color:#fff}',
    '.cfu-c{font-size:11.5px}',
    '.cfu-up{color:#34D399}.cfu-dn{color:#F87171}.cfu-eq{color:#8FA0BE}',
    '.cfu-msg{padding:12px 24px;color:#8FA0BE}',
    '@keyframes cfu-move{to{transform:translateX(calc(-1 * var(--cfu-w,50%)))}}',
    '.cfu-tk.cfu-quieto .cfu-tk-track{animation:none}',
    '.cfu-tk.cfu-quieto .cfu-tk-view{overflow-x:auto;scrollbar-width:none}',
    '.cfu-tk.cfu-quieto .cfu-tk-view:focus-visible{outline:2px solid #60A5FA;outline-offset:-2px}',
    '@media (max-width:640px){.cfu-tk-tag{display:none}.cfu-i{padding:11px 16px}}'
  ].join('\n');

  var barra, vista, datosChile = null, datosMercados = null;
  var sinMovimiento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function numero(valor, decimales) {
    return Number(valor).toLocaleString('es-CL', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  }

  function fechaCorta(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function leerCache() {
    try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)) || null; } catch (e) { return null; }
  }
  function guardarCache() {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ chile: datosChile, mercados: datosMercados })); } catch (e) { /* sin almacenamiento */ }
  }

  // Une ambas fuentes en una sola lista ordenada
  function armarItems() {
    var porId = {};
    if (datosMercados && Array.isArray(datosMercados.items)) {
      datosMercados.items.forEach(function (it) {
        if (!it || !it.id || typeof it.valor !== 'number') return;
        // Un dato sin fecha o con más de 5 días no se muestra: mejor omitirlo que mostrar algo desactualizado
        var edad = Date.now() - new Date(it.fecha).getTime();
        if (isNaN(edad) || edad > 5 * 86400000) return;
        porId[it.id] = it;
      });
    }
    if (datosChile) {
      CHILE.forEach(function (def) {
        var d = datosChile[def.clave];
        if (!d || typeof d.valor !== 'number') return;
        if (def.respaldo && porId[def.id]) return;
        porId[def.id] = { id: def.id, nombre: def.nombre, valor: d.valor, prefijo: def.prefijo, sufijo: def.sufijo, decimales: def.decimales, fecha: d.fecha };
      });
    }
    var items = [];
    CONFIG.orden.forEach(function (id) { if (porId[id]) { items.push(porId[id]); delete porId[id]; } });
    Object.keys(porId).forEach(function (id) { items.push(porId[id]); });
    return items;
  }

  function crear(tag, clase, texto) {
    var el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  }

  function crearItem(it) {
    var el = crear('span', 'cfu-i');
    var dec = typeof it.decimales === 'number' ? it.decimales : 2;
    el.appendChild(crear('span', 'cfu-n', it.nombre));
    el.appendChild(crear('span', 'cfu-v', (it.prefijo || '') + numero(it.valor, dec) + (it.sufijo || '')));
    if (typeof it.variacion === 'number') {
      var v = it.variacion;
      var clase = v > 0 ? 'cfu-up' : v < 0 ? 'cfu-dn' : 'cfu-eq';
      var flecha = v > 0 ? '▲ +' : v < 0 ? '▼ ' : '= ';
      el.appendChild(crear('span', 'cfu-c ' + clase, flecha + numero(v, 2) + '%'));
    }
    if (it.fecha) el.title = it.nombre + ' · dato del ' + fechaCorta(it.fecha);
    return el;
  }

  function pintar() {
    var items = armarItems();
    if (!items.length) return false;

    var grupo = crear('div', 'cfu-tk-group');
    items.forEach(function (it) { grupo.appendChild(crearItem(it)); });

    var pista = crear('div', 'cfu-tk-track');
    pista.appendChild(grupo);
    vista.textContent = '';
    vista.appendChild(pista);

    if (sinMovimiento) {
      barra.classList.add('cfu-quieto');
      vista.tabIndex = 0;
      return true;
    }
    // Se repite el grupo las veces necesarias para que la cinta nunca muestre un hueco
    var ancho = grupo.getBoundingClientRect().width;
    if (!ancho) return true;
    var copias = Math.ceil(vista.getBoundingClientRect().width / ancho) + 1;
    for (var i = 0; i < copias; i++) {
      var copia = grupo.cloneNode(true);
      copia.setAttribute('aria-hidden', 'true');
      pista.appendChild(copia);
    }
    pista.style.setProperty('--cfu-w', ancho + 'px');
    pista.style.setProperty('--cfu-d', Math.max(20, Math.round(ancho / CONFIG.pxPorSegundo)) + 's');
    return true;
  }

  function pedir(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' respondió ' + r.status);
      return r.json();
    });
  }

  function actualizar() {
    var demo = window.CFU_INDICADORES_DEMO; // datos fijos para vistas previas
    var tareas = demo
      ? [Promise.resolve(demo.chile), Promise.resolve(demo.mercados)]
      : [pedir(CONFIG.chileUrl), pedir(CONFIG.mercadosUrl).catch(function () { return pedir(CONFIG.respaldoUrl); })];

    return Promise.allSettled(tareas).then(function (res) {
      if (res[0].status === 'fulfilled' && res[0].value) datosChile = res[0].value;
      if (res[1].status === 'fulfilled' && res[1].value) datosMercados = res[1].value;
      if (pintar()) guardarCache();
      else barra.hidden = true; // sin datos ni caché: mejor no mostrar una barra vacía
    });
  }

  function iniciar() {
    var header = document.querySelector('header');
    if (!header || document.querySelector('.cfu-tk')) return;

    var estilo = document.createElement('style');
    estilo.textContent = CSS;
    document.head.appendChild(estilo);

    barra = crear('div', 'cfu-tk');
    barra.setAttribute('role', 'region');
    barra.setAttribute('aria-label', 'Indicadores financieros');
    barra.appendChild(crear('span', 'cfu-tk-tag', 'Indicadores'));
    vista = crear('div', 'cfu-tk-view');
    vista.appendChild(crear('div', 'cfu-msg', 'Cargando indicadores…'));
    barra.appendChild(vista);

    if (CONFIG.fijo) header.appendChild(barra);
    else header.insertAdjacentElement('afterend', barra);

    // Muestra de inmediato lo último que se vio en esta sesión y luego refresca
    var cache = leerCache();
    if (cache) { datosChile = cache.chile; datosMercados = cache.mercados; pintar(); }

    actualizar();
    setInterval(function () { if (!document.hidden) actualizar(); }, CONFIG.refrescoMin * 60000);

    var espera;
    window.addEventListener('resize', function () {
      clearTimeout(espera);
      espera = setTimeout(pintar, 200);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
