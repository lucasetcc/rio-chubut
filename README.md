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
  - lluvia acumulada e indicadores automáticos (criterio propio, no oficial).
- **`netlify/functions/settings.mts`**: guarda la configuración compartida en Netlify Blobs: reglas, umbrales manuales (con fuente y URL obligatorias), carga manual del dique y estaciones agregadas. **Leer es público; guardar pide la clave `ADMIN_KEY`.**
  - `ADMIN_KEY` debe tener **20 caracteres o más** (si no, guardar devuelve error 500). Generá una con `openssl rand -base64 24`.
  - Comparación de clave en tiempo constante, bloqueo por IP tras 5 intentos fallidos en 15 min, validación de esquema y control de concurrencia (409 si otro guardó en el medio).
- **`netlify/functions/forecast.mts`**: pronóstico de lluvia de Open-Meteo (modelos globales; no es un pronóstico oficial del SMN).
- La sección de administración sólo aparece con `?admin` en la URL.

## Reglas de los datos
- **Lectura de escala ≠ profundidad.** El cero de cada estación es arbitrario; no se comparan números entre estaciones.
- **Sin datos no es cero.** Lluvia sin registros = "sin datos", nunca 0 mm.
- **Dato viejo (>24 h) = SIN ACTUALIZAR**: no genera subidas, indicadores ni propagación.
- **Promedios** sólo con ≥70 % de días con datos. **Percentil/clase** sólo contra el mismo mes de ≥3 años anteriores.
- **No hay umbrales oficiales automáticos**: un umbral sólo se usa si se carga con fuente y URL.
- **Dique:** datos publicados en prensa, con fecha, fuente y precisión (una cota "aprox." se compara en metros enteros).

## Tests
`npm test` (Vitest). `npm run build` corre los tests antes de compilar: si un test falla, Netlify no publica.

## Publicar en Netlify (una vez)

**Opción A — desde GitHub (recomendada, se re-publica sola con cada cambio)**
1. Subí esta carpeta a un repositorio de GitHub.
2. En Netlify: *Add new site → Import an existing project → GitHub* y elegí el repo. La configuración de build se toma de `netlify.toml`.
3. En *Site configuration → Environment variables* agregá `ADMIN_KEY` con una clave aleatoria de 20+ caracteres (sirve para guardar configuración desde la web). No la compartas en chats ni documentos.
4. *Deploys → Trigger deploy*. Listo: `https://<tu-sitio>.netlify.app`.

**Opción B — desde tu compu con la CLI**
```bash
npm install
npx netlify-cli login
npx netlify-cli init            # crea el sitio
npx netlify-cli env:set ADMIN_KEY "$(openssl rand -base64 24)"
npx netlify-cli deploy --build --prod
```
> El "arrastrar y soltar" de Netlify **no sirve**: no publica las funciones, y sin ellas la página no tiene datos.

**Probar local:** `npm install && npx netlify-cli dev` (abre http://localhost:8888).

## Agregar estaciones
- **Desde la web:** abrí la página con `?admin` → **Buscar ahora**. La búsqueda revisa el INA en la zona de la cuenca y lista las series nuevas; tocás **Agregar** en las que quieras sumar.
- **En el código:** editar `src/data/stations.json` (mismo formato que las demás) y volver a publicar.

## Limitaciones
- **No hay caudal ni curva de gasto públicos en el INA.** Solo se muestra nivel (m), sobre la escala local de cada estación.
- **Dique:** no hay fuente oficial periódica. Se muestran declaraciones publicadas (`src/data/dam_reference.json`) y cargas manuales con fuente; cada dato indica su antigüedad.
- **Primera carga fría:** tarda ~10–20 s mientras el CDN todavía no tiene las series. Después carga en ~1–2 s.
- **Indicadores:** se evalúan cada vez que se abre la página; no hay historial ni notificaciones push. "Visto" se recuerda en cada dispositivo.
- **Plan gratis de Netlify:** alcanza de sobra para uso personal. El caché hace que casi ninguna visita llegue a ejecutar la función.
- **No es un sistema oficial de alerta.** La propagación es una estimación estadística.
- **Exportación:** CSV y JSON (se quitó Excel por una vulnerabilidad sin parche en la librería `xlsx`).
- **Pendiente:** confirmar con el INA el intervalo que cubre cada registro de lluvia; climatología larga (BDHI) para tener percentiles con más años.
