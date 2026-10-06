// Club de Finanzas UACh — genera indicadores.json (respaldo de la barra de indicadores).
// La fuente principal es el Worker de Cloudflare (/api/indicadores); este archivo lo
// ejecuta la GitHub Action .github/workflows/indicadores.yml para dejar una copia en la
// rama "datos", que se usa solo si el Worker no puede obtener los datos.
// Uso: node scripts/actualizar-indicadores.mjs <carpeta-de-salida>

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { obtenerIndicadores, SIMBOLOS } from '../worker/fuentes.js';

const SALIDA = process.argv[2] || 'salida';
const PUBLICADO = `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY || 'HeberLevitureo/Club-de-Finanzas-UACh-PM'}/datos/indicadores.json`;

async function leerPublicado() {
  const res = await fetch(PUBLICADO);
  if (!res.ok) return [];
  return (await res.json()).items || [];
}

const { items, nuevos, avisos } = await obtenerIndicadores({
  leerAnteriores: leerPublicado,
  simularFallaYahoo: Boolean(process.env.SIMULAR_FALLA_YAHOO),
});
avisos.forEach((a) => console.warn(a));

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
