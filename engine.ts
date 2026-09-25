/** Carga los datos del INA (vía /api/ina, cacheado en Netlify), marca calidad y arma todas las vistas. */
import seed from "./stations.json";
import * as an from "./analytics";
import { CFG, H, D, iso, P } from "./analytics";

export type Quality = "VALID" | "SUSPECT" | "MISSING";
export type Obs = { t: number; v: number | null; q: Quality; note?: string };
export type SeriesDef = { id: number; role: "level" | "rain" | "level_hist" | "discharge"; var_id: number; ina_station_id?: number };
export type StationDef = { key: string; name: string; river: string; kind: string; main: boolean; chain_order: number | null;
  ina_station_id: number; lat: number; lon: number; notes: string; near_hydro?: string; series: SeriesDef[] };

const EXPECTED_UNIT: Record<string, string> = { level: "m", level_hist: "m", rain: "mm", discharge: "m^3/s" };
export const sourceUrl = (id: number) => `https://alerta.ina.gob.ar/a5/secciones?seriesId=${id}&tipo=puntual`;

// ------------------------------------------------------------------ settings compartidos
export type Settings = {
  rules?: any[]; thresholds?: Record<string, { crecida_m: number; source?: string; url?: string }>; dam?: any[];
  dam_limits?: { cota_max_normal?: number | null; cota_min_operativa?: number | null };
  extra_series?: any[]; ignored_series?: number[]; discovery?: { last_run: string; candidates: any[] }; updated_at?: string;
};

export const DEFAULT_RULES = [
  { id: 1, type: "rise", station_key: "cerro_condor", params: { cm: 10, hours: 6 }, enabled: 1, description: "Cerro Cóndor subió más de 10 cm en 6 h" },
  { id: 3, type: "trend", station_key: "los_altares", params: { direction: "SUBIENDO" }, enabled: 1, description: "Los Altares está creciendo" },
  { id: 4, type: "propagation", station_key: "las_plumas", params: {}, enabled: 1, description: "Las Plumas recibe una señal de subida aguas arriba" },
  { id: 5, type: "rain", station_key: null, params: { mm: 20, hours: 24 }, enabled: 1, description: "Lluvia acumulada > 20 mm en 24 h (valor editable)" },
];

async function getJSON(url: string, tries = 2): Promise<any> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      return body;
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1500)); }
  }
  throw last;
}

/** Limita la concurrencia para no disparar decenas de consultas juntas. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()!); }));
}

const bucket10 = () => Math.floor(Date.now() / 600e3);
const bucketH = () => Math.floor(Date.now() / 3600e3);

// ------------------------------------------------------------------ estado global
type SeriesState = {
  def: SeriesDef; station: string; obs: Obs[]; meta?: any; verify: "pending" | "ok" | "mismatch" | "error";
  verify_detail?: string; unit?: string; error?: string; error_at?: string; fetched_at?: string; baseFrom?: number; issues: { ts: string; issue: string; detail: string }[];
  closedRows?: [string, any][]; closedKey?: string; closedBad?: number;
};

export const S = {
  stations: [] as StationDef[],
  series: new Map<number, SeriesState>(),
  settings: {} as Settings,
  loadedAt: 0,
  loading: false,
  lastError: null as string | null,
  version: 0,
  progress: { done: 0, total: 0 },
};

function buildCatalog() {
  const base: StationDef[] = JSON.parse(JSON.stringify((seed as any).stations));
  for (const x of S.settings.extra_series || []) {
    let st = base.find((s) => s.key === x.station_key) || base.find((s) => s.ina_station_id === x.ina_station_id);
    if (!st) {
      st = { key: x.station_key, name: String(x.name || x.station_key).replace(/[<>&"'`]/g, ""), river: x.river || "", kind: x.role === "rain" ? "rain" : "hydro", main: false, chain_order: x.chain_order ?? null,
        ina_station_id: x.ina_station_id, lat: x.lat, lon: x.lon, notes: "Agregada desde descubrimiento", series: [] };
      base.push(st);
    }
    if (!st.series.some((s) => s.id === x.series_id)) st.series.push({ id: x.series_id, role: x.role, var_id: x.var_id, ina_station_id: x.ina_station_id });
  }
  S.stations = base;
}

function flag(role: string, v: number | null): [Quality, string?] {
  if (v === null || Number.isNaN(v)) return ["MISSING", "valor nulo en la fuente"];
  if (role === "level" || role === "level_hist") {
    if (v < CFG.levelMin || v > CFG.levelMax) return ["SUSPECT", "valor fuera de rango físico"];
  }
  if (role === "rain" && (v < 0 || v > CFG.rainMaxStep)) return ["SUSPECT", "valor de lluvia imposible"];
  return ["VALID"];
}

async function loadSeries(st: SeriesState) {
  const def = st.def;
  // 1) verificar metadata: la serie debe ser de la estación y variable esperadas
  try {
    const m = await getJSON(`/api/ina/meta/${def.id}/${bucketH()}`);
    st.meta = m;
    const problems: string[] = [];
    const expSt = def.ina_station_id ?? S.stations.find((s) => s.key === st.station)?.ina_station_id;
    if (expSt && m.estacion?.id !== expSt) problems.push(`estación INA ${m.estacion?.id} ≠ esperada ${expSt}`);
    if (def.var_id && m.var?.id !== def.var_id) problems.push(`variable ${m.var?.id} (${m.var?.var}) ≠ esperada ${def.var_id}`);
    const u = m.unidades?.abrev;
    const eu = EXPECTED_UNIT[def.role];
    if (u && eu && u !== eu && !(def.role === "rain" && String(u).startsWith("mm"))) problems.push(`unidad '${u}' ≠ esperada '${eu}'`);
    st.unit = u || eu;
    st.verify = problems.length ? "mismatch" : "ok";
    st.verify_detail = problems.join("; ") || undefined;
    if (problems.length) return;
    const c = m.estacion?.geom?.coordinates;
    const sd = S.stations.find((s) => s.key === st.station);
    if (c && sd && def.role !== "level_hist") { sd.lat = c[1]; sd.lon = c[0]; }
  } catch (e) {
    st.verify = st.obs.length ? st.verify : "error"; st.error = String(e); st.error_at = iso(Date.now()); return;
  }
  // 2) observaciones por año (años cerrados: cache largo; año actual: cache 10 min)
  const tsStart = st.meta?.date_range?.timestart ? Date.parse(st.meta.date_range.timestart) : Date.now() - 400 * D;
  const tsEnd = st.meta?.date_range?.timeend ? Date.parse(st.meta.date_range.timeend) : Date.now();
  // trimestres: cerrados -> cache largo; el actual -> cache 10 min
  const qIdx = (ms: number) => { const d = new Date(ms); return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3); };
  const nowQ = qIdx(Date.now());
  let firstQ = qIdx(tsStart);
  if (def.role === "rain") firstQ = Math.max(firstQ, nowQ - 5); // lluvia: ~último año y medio alcanza
  const lastQ = Math.min(qIdx(tsEnd), nowQ);
  // Los trimestres cerrados no cambian: se descargan una vez y en las recargas sólo se pide el trimestre actual.
  const closed: string[] = [];
  for (let q = firstQ; q <= Math.min(lastQ, nowQ - 1); q++) closed.push(`/api/ina/obs/${def.id}/${Math.floor(q / 4)}-Q${(q % 4) + 1}`);
  const needRecent = lastQ >= nowQ || Date.now() - tsEnd < 120 * D;
  const closedKey = closed.join("|");
  const rows: [string, any][] = [];
  let bad = 0;
  try {
    if (st.closedKey !== closedKey || !st.closedRows) {
      const cr: [string, any][] = [];
      let cb = 0;
      for (const u of closed) { const r = await getJSON(u); cr.push(...r.data); cb += r.bad_format || 0; }
      st.closedRows = cr; st.closedKey = closedKey; st.closedBad = cb;
    }
    rows.push(...st.closedRows);
    bad += st.closedBad || 0;
    if (needRecent) {
      const r = await getJSON(`/api/ina/obs/${def.id}/recent/${bucket10()}`);
      rows.push(...r.data);
      bad += r.bad_format || 0;
      st.fetched_at = r.fetched_at;
    }
  } catch (e) {
    // falla parcial: se conservan los datos ya cargados y se informa el error
    st.error = `No se pudieron descargar los datos: ${String(e)}`;
    st.error_at = iso(Date.now());
    if (st.verify === "ok" && !st.obs.length) st.verify = "error";
    return;
  }
  st.issues = [];
  st.baseFrom = undefined;
  if (bad) st.issues.push({ ts: iso(Date.now()), issue: "format", detail: `${bad} observaciones con formato inesperado` });
  // parsear, ordenar, deduplicar y marcar calidad (nunca se descarta un dato: se marca)
  const parsed: { t: number; v: number | null }[] = [];
  for (const [ts, val] of rows) {
    const naive = !/Z$|[+-]\d\d:?\d\d$/.test(ts);
    const t = Date.parse(naive ? `${ts}-03:00` : ts);
    if (Number.isNaN(t)) { st.issues.push({ ts: iso(Date.now()), issue: "format", detail: `timestamp ilegible: ${ts}` }); continue; }
    if (naive) st.issues.push({ ts: iso(t), issue: "naive_timestamp", detail: "timestamp sin zona; interpretado como hora argentina" });
    const v = val === null || val === undefined || val === "" ? null : Number(val);
    parsed.push({ t, v: v === null || Number.isNaN(v) ? null : v });
  }
  parsed.sort((a, b) => a.t - b.t);
  const obs: Obs[] = [];
  for (const p of parsed) {
    const last = obs[obs.length - 1];
    if (last && last.t === p.t) {
      if (last.v !== p.v) st.issues.push({ ts: iso(p.t), issue: "duplicate_ts", detail: `timestamp repetido con valores ${last.v} y ${p.v}` });
      continue;
    }
    const [q, note] = flag(def.role, p.v);
    if (q === "SUSPECT") st.issues.push({ ts: iso(p.t), issue: "impossible", detail: `${note} (${p.v})` });
    obs.push({ t: p.t, v: p.v, q, note });
  }
  // Saltos: sólo se marca SUSPECT un pico aislado (sube y vuelve, o baja y vuelve, en pasos consecutivos
  // de ≤48 h). Un escalón que se mantiene (crecida real o cambio de cero de escala) NO se descarta:
  // queda registrado como aviso de calidad.
  if (def.role === "level" || def.role === "level_hist") {
    const th = CFG.suspectJumpM;
    const ok = obs.filter((o) => o.q === "VALID");
    for (let i = 1; i < ok.length; i++) {
      const a = ok[i - 1], b = ok[i], c = ok[i + 1];
      const d1 = (b.v as number) - (a.v as number);
      if (Math.abs(d1) <= th) continue;
      const near = (b.t - a.t) <= 48 * H;
      if (c && near && (c.t - b.t) <= 48 * H) {
        const d2 = (c.v as number) - (b.v as number);
        if (Math.abs(d2) > th && Math.sign(d2) !== Math.sign(d1)) {
          b.q = "SUSPECT"; b.note = `pico aislado de ${d1 > 0 ? "+" : ""}${d1.toFixed(2)} m`;
          st.issues.push({ ts: iso(b.t), issue: "jump", detail: `${b.note} (${b.v})` });
          i++; // el regreso después del pico no es un escalón
          continue;
        }
      }
      // Cambio de cero de escala: escalón grande tras un corte, y DESPUÉS el río nunca vuelve al rango previo.
      // (Una crecida o una bajada normal sí vuelve a pasar por esos niveles, así que no se confunde.)
      if (!near && (b.t - a.t) > 7 * D) {
        const pre = ok.filter((o) => o.t <= a.t && o.t >= a.t - 60 * D).map((o) => o.v as number).sort((x, y) => x - y);
        const post = ok.filter((o) => o.t >= b.t).map((o) => o.v as number);
        if (pre.length >= 10 && post.length >= 10) {
          const p5 = pre[Math.floor(pre.length * 0.05)], p95 = pre[Math.floor(pre.length * 0.95)];
          const [postMin, postMax] = an.minMax(post);
          if ((d1 > 0 && postMin > p95 + 0.3) || (d1 < 0 && postMax < p5 - 0.3)) st.baseFrom = b.t;
        }
      }
      st.issues.push({ ts: iso(b.t), issue: "level_shift", detail: `escalón de ${d1 > 0 ? "+" : ""}${d1.toFixed(2)} m ${near ? "" : `tras ${Math.round((b.t - a.t) / D)} días sin datos `}(crecida real o posible cambio de cero de escala)` });
    }
  }
  st.obs = obs;
  st.error = undefined;
  st.error_at = undefined;
}

export async function loadSettings() {
  try { S.settings = await getJSON("/api/settings", 1); } catch { S.settings = {}; }
}

let inflight: Promise<void> | null = null;
export function loadAll(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && S.loadedAt && Date.now() - S.loadedAt < 5 * 60e3) return Promise.resolve();
  inflight = doLoad().finally(() => { inflight = null; });
  return inflight;
}

async function doLoad() {
  S.loading = true;
  try {
    await loadSettings();
    buildCatalog();
    const defs: SeriesState[] = [];
    for (const s of S.stations) for (const d of s.series) {
      if (d.role === "level_hist") continue; // se carga a pedido
      const old = S.series.get(d.id);
      defs.push(old ? { ...old, def: d, station: s.key } : { def: d, station: s.key, obs: [], verify: "pending", issues: [] });
    }
    S.progress = { done: 0, total: defs.length };
    await pool(defs, 4, async (st) => { try { await loadSeries(st); } catch (e) { st.verify = "error"; st.error = String(e); } S.series.set(st.def.id, st); S.progress.done++; });
    S.loadedAt = Date.now();
    const lvl = [...S.series.values()].filter((x) => x.def.role === "level");
    S.lastError = lvl.length && lvl.every((x) => x.verify === "error") ? "No se pudo contactar al INA (se muestran los datos ya cargados)." : null;
    S.version++;
  } finally {
    S.loading = false;
  }
}

export async function loadHist(stationKey: string) {
  const sd = S.stations.find((s) => s.key === stationKey);
  const d = sd?.series.find((x) => x.role === "level_hist");
  if (!d) return [];
  let st = S.series.get(d.id);
  if (!st || !st.obs.length) {
    st = { def: d, station: stationKey, obs: [], verify: "pending", issues: [] };
    await loadSeries(st);
    S.series.set(d.id, st);
  }
  return st.obs;
}

// ------------------------------------------------------------------ accesos
export function seriesOf(key: string, role: string): SeriesState | undefined {
  const sd = S.stations.find((s) => s.key === key);
  const d = sd?.series.find((x) => x.role === role);
  return d ? S.series.get(d.id) : undefined;
}
export function usable(key: string, role = "level", since = 0): P[] {
  const st = seriesOf(key, role);
  if (!st || st.verify === "mismatch") return [];
  return st.obs.filter((o) => o.q === "VALID" && o.v !== null && o.t >= since).map((o) => [o.t, o.v as number]);
}
export function lastTs(key: string, role: string): number | null {
  const st = seriesOf(key, role);
  return st?.obs.length ? st.obs[st.obs.length - 1].t : null;
}
/** Timestamp del último registro VALID (no cuenta nulos ni sospechosos). */
export function lastValidTs(key: string, role: string): number | null {
  const st = seriesOf(key, role);
  if (!st || st.verify === "mismatch") return null;
  for (let i = st.obs.length - 1; i >= 0; i--) if (st.obs[i].q === "VALID" && st.obs[i].v !== null) return st.obs[i].t;
  return null;
}
