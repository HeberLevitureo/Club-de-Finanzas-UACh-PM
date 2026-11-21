# Club de Finanzas UACh: guía para trabajar en este repo

Sitio estático (HTML + Tailwind) publicado con un Cloudflare Worker en https://clubdefinanzasuach.cl.
Esta guía la leen las sesiones de Claude Code. También sirve de lista de chequeo para cualquier persona del club.

## Reglas de trabajo
- **Nunca subir directo a `main`.** Todo cambio va en una rama y se publica con un pull request para revisarlo.
- **Cambios puntuales, no reemplazos de archivos completos** (`index.html`, etc.): más de una persona edita el repo y se pueden pisar cambios.
- **No inventar datos.** Si algo no se puede comprobar, no se escribe. Las crónicas cuentan solo lo que se hizo y se conversó.

## Tailwind: el CSS se compila (importante)
El sitio ya no usa el CDN de Tailwind. Los estilos están en `tailwind.css`, generado desde `src/tailwind.css` y `tailwind.config.js`.
- Si se agrega o cambia **cualquier clase de Tailwind** en un `.html` o en `indicadores.js`, hay que regenerar el CSS:
  `npm install` (solo la primera vez) y `npm run build:css`, y subir `tailwind.css` en el mismo cambio.
- Una GitHub Action (`.github/workflows/tailwind.yml`) lo hace sola en los PR; aun así, compilar antes de abrir el PR evita sorpresas.
- Si una clase nueva "no hace nada", casi seguro falta recompilar.
- No volver a poner `cdn.tailwindcss.com` en ninguna página.

## Al crear una publicación o página nueva
1. Copiar la estructura de una nota existente (por ejemplo `feria-laboral-23-oct-2026.html`), incluido `<link rel="stylesheet" href="tailwind.css">`.
2. **URLs siempre con `.html`** en canonical, `og:url`, sitemap y enlaces internos.
3. `og:image` con URL absoluta del dominio oficial (`https://clubdefinanzasuach.cl/...`).
4. Agregar la nota a `PUBLICACIONES` en `index.html` y, si es actividad del club, a `ACTIVIDADES` y subir el contador `actividadesRealizadas` en `CLUB`.
5. Agregar la URL a `sitemap.xml` y actualizar el `lastmod` de la home.
6. Imágenes: máximo 1280 px de lado, JPG de calidad ~80 (portadas ~1280×720 o similar); logos y flyers en PNG reducido. Añadir `loading="lazy"` a las que no estén en la primera pantalla.
7. Compilar Tailwind (ver arriba).

## Datos oficiales del club
- Web: https://clubdefinanzasuach.cl
- Correo: clubdefinanzas@uach.cl
- Instagram: https://www.instagram.com/clubdefinanzasuach/ (el handle antiguo `@clubfinanzasuach` ya no vale)
- LinkedIn: https://www.linkedin.com/company/club-de-finanzas-uach/

## Seguridad y caché (Worker)
- `worker/index.js` agrega cabeceras de seguridad, redirige HTTP→HTTPS, workers.dev y www al dominio oficial, y sirve las páginas con `.html`.
- La CSP está en modo `Report-Only`. Si se agrega un script o estilo de otro dominio, hay que sumarlo a la CSP.
- Imágenes, CSS y JS se cachean 1 día: si se reemplaza una imagen con el mismo nombre, puede tardar en verse. Mejor usar un nombre nuevo.
