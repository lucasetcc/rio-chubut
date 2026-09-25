/**
 * Proxy de sólo lectura a la API pública del INA (https://alerta.ina.gob.ar/a5).
 * - Evita problemas de CORS.
 * - Cachea en el CDN de Netlify: todos los visitantes comparten la misma respuesta,
 *   así el INA recibe como máximo una consulta por recurso cada 10 minutos.
 * - Todo va en la ruta (no en query) para que el cache sea inequívoco.
 *
 * Rutas:
 *   /api/ina/meta/<seriesId>/<bucket>          metadata de la serie
 *   /api/ina/obs/<seriesId>/<año>-Q<n>          observaciones de un trimestre cerrado (cache largo)
 *   /api/ina/obs/<seriesId>/recent/<bucket>     observaciones desde el inicio del trimestre actual hasta ahora
 *   /api/ina/estaciones/<texto>                 búsqueda de estaciones por nombre
 *   /api/ina/series-estacion/<estacionId>       series de una estación
 * <bucket> es un número que cambia cada 10 min (lo calcula el navegador) -> define la vigencia del cache.
 */
import type { Config } from "@netlify/functions";

const BASE = "https://alerta.ina.gob.ar/a5/obs/puntual";
const UA = "rio-chubut-monitor/1.0 (monitoreo hidrologico; cache 10 min)";

function json(body: unknown, status: number, cdn: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120",
      "netlify-cdn-cache-control": cdn,
    },
  });
}

async function ina(url: string): Promise<any> {
  // un solo intento con 9 s (el límite de Netlify es 10 s); el navegador reintenta
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ctl.signal });
    if (r.status >= 500 || r.status === 429) throw new Error(`INA HTTP ${r.status}`);
    if (!r.ok) return { __error: `INA HTTP ${r.status}`, __status: r.status };
    return await r.json();
  } finally {
    clearTimeout(to);
  }
}

const SHORT = "public, durable, s-maxage=600, stale-while-revalidate=1800";
const LONG = "public, durable, s-maxage=604800, stale-while-revalidate=604800";
const NOCACHE = "no-store";

export default async (req: Request) => {
  const parts = new URL(req.url).pathname.replace(/^\/api\/ina\/?/, "").split("/").filter(Boolean);
  try {
    const [kind, a, b] = parts;
    if (kind === "meta" && /^\d+$/.test(a)) {
      const d = await ina(`${BASE}/series/${a}`);
      if (d.__error) return json({ error: d.__error }, 502, NOCACHE);
      return json(d, 200, "public, durable, s-maxage=3600, stale-while-revalidate=86400");
    }
    if (kind === "obs" && /^\d+$/.test(a)) {
      const now = new Date();
      let start: string, end: string, cdn: string;
      const qStart = (y: number, q: number) => new Date(Date.UTC(y, (q - 1) * 3, 1)).toISOString().replace(/\.\d{3}Z$/, "Z");
      const curQ = Math.floor(now.getUTCMonth() / 3) + 1;
      const m = /^(\d{4})-Q([1-4])$/.exec(b || "");
      if (b === "recent") {
        start = qStart(now.getUTCFullYear(), curQ);
        end = new Date(now.getTime() + 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z");
        cdn = SHORT;
      } else if (m && Number(m[1]) > 1990 && (Number(m[1]) < now.getUTCFullYear() || (Number(m[1]) === now.getUTCFullYear() && Number(m[2]) < curQ))) {
        const y = Number(m[1]), q = Number(m[2]);
        start = qStart(y, q);
        end = q === 4 ? qStart(y + 1, 1) : qStart(y, q + 1);
        cdn = LONG;
      } else return json({ error: "ruta inválida" }, 400, NOCACHE);
      const d = await ina(`${BASE}/series/${a}/observaciones?timestart=${start}&timeend=${end}`);
      if (d?.__error) return json({ error: d.__error }, 502, NOCACHE);
      const rows = Array.isArray(d) ? d : d?.rows || d?.observaciones || [];
      // respuesta compacta: [timestart ISO, valor]
      const slim = rows
        .filter((o: any) => o && o.timestart !== undefined && "valor" in o)
        .map((o: any) => [o.timestart, o.valor]);
      const bad = rows.length - slim.length;
      return json({ series_id: Number(a), from: start, to: end, fetched_at: now.toISOString(), bad_format: bad, data: slim }, 200, cdn);
    }
    if (kind === "estaciones" && a) {
      const d = await ina(`${BASE}/estaciones?nombre=${encodeURIComponent(decodeURIComponent(a))}`);
      if (d?.__error) return json({ error: d.__error }, 502, NOCACHE);
      return json(d, 200, "public, durable, s-maxage=86400");
    }
    if (kind === "series-estacion" && /^\d+$/.test(a)) {
      const d = await ina(`${BASE}/series?estacion_id=${a}`);
      if (d?.__error) return json({ error: d.__error }, 502, NOCACHE);
      return json(d, 200, "public, durable, s-maxage=86400");
    }
    return json({ error: "ruta inválida" }, 400, NOCACHE);
  } catch (e) {
    return json({ error: `No se pudo contactar al INA: ${String(e)}` }, 504, NOCACHE);
  }
};

export const config: Config = { path: "/api/ina/*" };
