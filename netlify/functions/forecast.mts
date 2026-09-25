/**
 * Pronóstico meteorológico (Open-Meteo, modelos globales) para los puntos de la cuenca.
 * Una sola consulta para todas las estaciones; cache compartido de 30 min en el CDN de Netlify.
 * Ruta: /api/forecast/<bucket>   (<bucket> cambia cada 30 min, lo calcula el navegador)
 */
import type { Config } from "@netlify/functions";
import seed from "../../src/data/stations.json";
import { okBucket } from "../lib/validate";

const KEYS = ["alto_chubut", "norquinco", "el_maiten", "tecka", "gualjaina", "paso_del_sapo", "cerro_condor", "los_altares", "las_plumas"];

export default async (req: Request) => {
  const bucket = new URL(req.url).pathname.split("/").filter(Boolean)[2];
  if (!okBucket(bucket, 1800e3)) return new Response(JSON.stringify({ error: "bucket inválido" }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store", "netlify-cdn-cache-control": "no-store" } });
  const st = KEYS.map((k) => (seed as any).stations.find((s: any) => s.key === k)).filter(Boolean);
  const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
    latitude: st.map((s: any) => s.lat.toFixed(3)).join(","),
    longitude: st.map((s: any) => s.lon.toFixed(3)).join(","),
    daily: "precipitation_sum,precipitation_probability_max,snowfall_sum,temperature_2m_max,temperature_2m_min",
    timezone: "America/Argentina/Buenos_Aires",
    forecast_days: "6",
  });
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" };
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "rio-chubut-monitor/1.0" } });
    clearTimeout(to);
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
    const raw = await r.json();
    const list = Array.isArray(raw) ? raw : [raw];
    const out = {
      source: "Open-Meteo (modelos meteorológicos globales, selección automática)",
      source_url: "https://open-meteo.com/",
      fetched_at: new Date().toISOString(),
      units: list[0]?.daily_units ?? {},
      stations: st.map((s: any, i: number) => ({ key: s.key, name: s.name, lat: s.lat, lon: s.lon, daily: list[i]?.daily ?? null })),
    };
    return new Response(JSON.stringify(out), { headers: { ...headers, "netlify-cdn-cache-control": "public, durable, s-maxage=1800, stale-while-revalidate=3600" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: `No se pudo obtener el pronóstico: ${String(e)}` }), { status: 502, headers: { ...headers, "netlify-cdn-cache-control": "no-store" } });
  }
};

export const config: Config = { path: "/api/forecast/*" };
