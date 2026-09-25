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
 *   /api/ina/obs/<seriesId>/<año>               observaciones de un año cerrado (cache largo; red histórica)
 *   /api/ina/obs/<seriesId>/recent/<bucket>     observaciones desde el inicio del trimestre actual hasta ahora
 *   /api/ina/estaciones/<texto>                 búsqueda de estaciones por nombre
 *   /api/ina/series-estacion/<estacionId>/<día> series de una estación (<día> = bucket diario ±1)
 * <bucket> es un número que cambia cada 10 min (lo calcula el navegador) -> define la vigencia del cache.
 */
import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import seed from "../../src/data/stations.json";
import { okBucket } from "../lib/validate";

const SEED_IDS = new Set<number>((seed as any).stations.flatMap((s: any) => s.series.map((x: any) => x.id)));
const TERMS = new Set<string>(((seed as any).discovery?.search_terms || []).map((t: string) => t.toLowerCase()));

/** Sólo se sirven series del catálogo o agregadas desde la configuración (evita usar el proxy para cualquier serie). */
async function allowedSeries(id: number): Promise<boolean> {
  if (SEED_IDS.has(id)) return true;
  try {
    const st: any = await getStore({ name: "rio-chubut" }).get("settings", { type: "json" });
    return !!st?.extra_series?.some((x: any) => x.series_id === id);
  } catch { return false; }
}

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
    const [kind, a, b, c] = parts;
    if ((kind === "meta" || kind === "obs") && (!/^\d{1,7}$/.test(a || "") || !(await allowedSeries(Number(a)))))
      return json({ error: "serie no permitida" }, 404, NOCACHE);
    if (kind === "meta" && !okBucket(b, 3600e3)) return json({ error: "bucket inválido" }, 400, NOCACHE);
    if (kind === "obs" && b === "recent" && !okBucket(c, 600e3)) return json({ error: "bucket inválido" }, 400, NOCACHE);
    if (kind === "meta") {
      const d = await ina(`${BASE}/series/${a}`);
      if (d.__error) return json({ error: d.__error }, 502, NOCACHE);
      return json(d, 200, "public, durable, s-maxage=3600, stale-while-revalidate=86400");
    }
    if (kind === "obs") {
      const now = new Date();
      let start: string, end: string, cdn: string;
      const qStart = (y: number, q: number) => new Date(Date.UTC(y, (q - 1) * 3, 1)).toISOString().replace(/\.\d{3}Z$/, "Z");
      const curQ = Math.floor(now.getUTCMonth() / 3) + 1;
      const m = /^(\d{4})-Q([1-4])$/.exec(b || "");
      const yr = /^(\d{4})$/.exec(b || "");
      if (b === "recent") {
        start = qStart(now.getUTCFullYear(), curQ);
        end = new Date(now.getTime() + 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z");
        cdn = SHORT;
      } else if (yr && Number(yr[1]) >= 2000 && Number(yr[1]) < now.getUTCFullYear()) {
        start = qStart(Number(yr[1]), 1);
        end = qStart(Number(yr[1]) + 1, 1);
        cdn = LONG;
      } else if (m && Number(m[1]) >= 2000 && (Number(m[1]) < now.getUTCFullYear() || (Number(m[1]) === now.getUTCFullYear() && Number(m[2]) < curQ))) {
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
    if (kind === "estaciones" && a && TERMS.has(decodeURIComponent(a).toLowerCase())) {
      const d = await ina(`${BASE}/estaciones?nombre=${encodeURIComponent(decodeURIComponent(a))}`);
      if (d?.__error) return json({ error: d.__error }, 502, NOCACHE);
      return json(d, 200, "public, durable, s-maxage=86400");
    }
    if (kind === "series-estacion" && /^\d{1,6}$/.test(a || "")) {
      if (!okBucket(b, 86400e3)) return json({ error: "bucket inválido" }, 400, NOCACHE);
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
