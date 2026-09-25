# Río Chubut — Monitor Hidrológico (versión web / Netlify)

Página web que muestra el estado de la cuenca del Río Chubut que aporta al Dique Florentino Ameghino, con **datos reales del INA** (alerta.ina.gob.ar). Se abre la URL y se ve actualizada; la página se refresca sola cada 5 minutos.

## Cómo funciona
- **`netlify/functions/ina.mts`**: proxy de solo lectura a la API pública del INA (`/a5/obs/puntual/...`).
  - Evita problemas de CORS.
  - Las respuestas quedan **cacheadas en el CDN de Netlify** (10 min para datos recientes, 7 días para años cerrados). Todos los visitantes comparten ese caché, así que el INA recibe como máximo una consulta por serie cada 10 minutos, entre o no gente.
- **El navegador** descarga las series, marca la calidad de cada dato (VALID / SUSPECT / MISSING) y hace todos los cálculos:
  - cambios de 1 h, 6 h, 24 h, 7 días y 30 días, y tendencia;
  - promedios, percentiles y comparación con el mismo mes de años anteriores;
  - detección de crecidas y propagación entre estaciones;
  - lluvia acumulada y alertas.
- **`netlify/functions/settings.mts`**: guarda la configuración compartida en Netlify Blobs: reglas de alerta, umbrales manuales, carga manual de cota del dique y estaciones agregadas. **Leer es público; guardar pide la clave `ADMIN_KEY`.**

## Publicar en Netlify (una vez)

**Opción A — desde GitHub (recomendada, se re-publica sola con cada cambio)**
1. Subí esta carpeta a un repositorio de GitHub.
2. En Netlify: *Add new site → Import an existing project → GitHub* y elegí el repo. La configuración de build se toma de `netlify.toml`.
3. En *Site configuration → Environment variables* agregá `ADMIN_KEY` con una clave tuya (sirve para guardar configuración desde la web).
4. *Deploys → Trigger deploy*. Listo: `https://<tu-sitio>.netlify.app`.

**Opción B — desde tu compu con la CLI**
```bash
npm install
npx netlify-cli login
npx netlify-cli init            # crea el sitio
npx netlify-cli env:set ADMIN_KEY "tu-clave"
npx netlify-cli deploy --build --prod
```
> El "arrastrar y soltar" de Netlify **no sirve**: no publica las funciones, y sin ellas la página no tiene datos.

**Probar local:** `npm install && npx netlify-cli dev` (abre http://localhost:8888).

## Agregar estaciones
- **Desde la web:** en *Datos y config.* → **Buscar ahora**. La búsqueda revisa el INA en la zona de la cuenca y lista las series nuevas; tocás **Agregar** en las que quieras sumar.
- **En el código:** editar `src/data/stations.json` (mismo formato que las demás) y volver a publicar.

## Limitaciones
- **No hay caudal ni curva de gasto públicos en el INA.** Solo se muestra nivel (m), sobre la escala local de cada estación.
- **Cota del embalse:** no tiene fuente pública estructurada. Solo carga manual, con la fuente obligatoria.
- **Primera carga fría:** tarda ~10–20 s mientras el CDN todavía no tiene las series. Después carga en ~1–2 s.
- **Alertas:** se evalúan cada vez que se abre la página; no hay historial ni notificaciones push. "Visto" se recuerda en cada dispositivo.
- **Plan gratis de Netlify:** alcanza de sobra para uso personal. El caché hace que casi ninguna visita llegue a ejecutar la función.
- **No es un sistema oficial de alerta.** La propagación es una estimación estadística.
