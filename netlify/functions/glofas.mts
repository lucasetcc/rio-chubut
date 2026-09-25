/**
 * Caudal MODELADO (GloFAS v4, Copernicus) vía Open-Meteo Flood API. No es medición.
 * Rutas:
 *   /api/glofas/recent/<bucket3h>    60 días pasados + 30 de pronóstico, 5 puntos candidatos por estación (cache 3 h)
 *   /api/glofas/hist/<lat>/<lon>     serie diaria 1984 → ayer de un punto (sólo puntos candidatos; cache 1 día)
 * El modelo toma "el río más grande en ~5 km", por eso se prueban 5 puntos por estación y el navegador elige.
 */
import type { Config } from "@netlify/functions";
import seed from "../../src/data/stations.json";
import { okBucket } from "../lib/validate";

export const GLOFAS_KEYS = ["el_maiten", "gualjaina", "paso_del_sapo", "cerro_condor", "los_altares", "las_plumas"];
const OFFS = [[0, 0], [0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]];
const API = "https://flood-api.open-meteo.com/v1/flood";

export function candidates() {
  const st = GLOFAS_KEYS.map((k) => (seed as any).stations.find((s: any) => s.key === k)).filter(Boolean);
  return st.flatMap((s: any) => OFFS.map(([a, b]) => ({ key: s.key, lat: +(s.lat + a).toFixed(3), lon: +(s.lon + b).toFixed(3) })));
}

const H = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600" };
const reply = (body: unknown, status: number, cdn: string) =>
  new Response(JSON.stringify(body), { status, headers: { ...H, "netlify-cdn-cache-control": cdn } });

async function om(params: Record<string, string>) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`${API}?${new URLSearchParams(params)}`, { signal: ctl.signal, headers: { "user-agent": "rio-chubut-monitor/1.0" } });
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(to); }
}

export default async (req: Request) => {
  const [, , , kind, a, b] = new URL(req.url).pathname.split("/");
  try {
    if (kind === "recent") {
      if (!okBucket(a, 3 * 3600e3)) return reply({ error: "bucket inválido" }, 400, "no-store");
      const c = candidates();
      const raw = await om({ latitude: c.map((x) => x.lat).join(","), longitude: c.map((x) => x.lon).join(","),
        daily: "river_discharge,river_discharge_median,river_discharge_p25,river_discharge_p75", past_days: "60", forecast_days: "30" });
      const list = Array.isArray(raw) ? raw : [raw];
      return reply({ source: "GloFAS v4 (Copernicus EMS) vía Open-Meteo", fetched_at: new Date().toISOString(),
        points: c.map((x, i) => ({ ...x, glat: list[i]?.latitude, glon: list[i]?.longitude, daily: list[i]?.daily ?? null })) },
        200, "public, durable, s-maxage=10800, stale-while-revalidate=21600");
    }
    if (kind === "hist") {
      const lat = Number(a), lon = Number(b);
      if (!candidates().some((x) => Math.abs(x.lat - lat) < 1e-6 && Math.abs(x.lon - lon) < 1e-6)) return reply({ error: "punto no permitido" }, 404, "no-store");
      const end = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
      const d = await om({ latitude: String(lat), longitude: String(lon), daily: "river_discharge", start_date: "1984-01-01", end_date: end });
      return reply({ lat, lon, daily: d.daily ?? null }, 200, "public, durable, s-maxage=86400, stale-while-revalidate=604800");
    }
    return reply({ error: "ruta inválida" }, 400, "no-store");
  } catch (e) {
    return reply({ error: `No se pudo consultar GloFAS: ${String(e)}` }, 502, "no-store");
  }
};

export const config: Config = { path: "/api/glofas/*" };
