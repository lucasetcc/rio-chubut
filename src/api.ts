export type Change = { delta_m: number | null; ref_ts?: string; ref_value?: number; reason?: string };

export type Status = {
  code: string; emoji: string; label: string; age_hours?: number; stale?: boolean; why?: string;
  trend?: { label: string; cm_per_day: number | null; threshold_cm_day?: number };
  p90_hist?: number | null; manual_threshold_m?: number | null;
};

export type SeriesInfo = {
  id: number; role: string; var_code: string | null; var_name: string | null; unit: string | null;
  verify_status: string; verify_detail: string | null; last_obs_ts: string | null; last_obs_local: string | null;
  source_url: string; last_fetch_status: string | null; last_error: string | null;
};

export type RainSummary = {
  last_ts: string | null; last_local?: string | null; stale: boolean;
  windows: Record<string, { mm: number | null; n: number; partial?: boolean; reason?: string }>;
  month_to_date: { mm: number | null; n: number } | null;
};

export type Flood = {
  available: boolean; messages: string[]; rise_cm: Record<string, number | null>;
  rate_cm_h: number | null; rate_cm_day: number | null; rapid_rise: boolean; sustained_rise: boolean;
  vs_avg30_cm?: number; disclaimer?: string;
  [k: string]: any;
};

export type Station = {
  key: string; name: string; ina_name: string | null; river: string; kind: string; main: number; chain_order: number | null;
  ina_station_id: number; lat: number; lon: number; notes: string; near_hydro: string | null;
  series: SeriesInfo[]; has_level: boolean; has_rain: boolean; has_discharge: boolean;
  source: { name: string; url: string };
  level?: { value: number; unit: string; ts: string; ts_local: string; changes: Record<string, Change> } | null;
  status?: Status;
  stats_brief?: { avg_7d: number | null; avg_30d: number | null; avg_365d: number | null; p90_hist: number | null;
    history_days: number; comparisons: Record<string, number | null>; same_month_mean: number | null } | null;
  flood?: Flood;
  discharge: null; discharge_note: string | null;
  rain?: RainSummary;
  spark?: [number, number][];
};

export type Describe = { n: number; mean: number | null; min: number | null; max: number | null; median: number | null;
  p10: number | null; p25: number | null; p75: number | null; p90: number | null; days_with_data?: number; days_expected?: number; since?: string };

export type Stats = {
  available: boolean; reason?: string; current: { ts: string; value: number }; today_mean: number | null;
  windows: Record<string, Describe>; comparisons: Record<string, number | null>;
  same_month_climatology: Describe & { years: string[]; month: number };
  percentile_rank_hist: number | null; history_days: number; method: string;
};

// ======================================================================================
// Implementación en el navegador: los datos vienen del INA vía /api/ina (cache en Netlify)
// y todos los cálculos se hacen acá. La configuración compartida vive en /api/settings.
// ======================================================================================
import * as an from "./data/analytics";
import { CFG, D, H, iso, localDate, P } from "./data/analytics";
import { DEFAULT_RULES, lastTs, loadAll, loadHist, loadSettings, S, seriesOf, Settings, sourceUrl, usable } from "./data/engine";
import { fDateTime } from "./fmt";
import seed from "./data/stations.json";

const localStr = (t: string | number | null | undefined) => (t == null ? null : fDateTime(typeof t === "number" ? iso(t) : t));

// ---------------------------------------------------------------- memo por versión de datos
const memo = new Map<string, { v: number; at: number; val: any }>();
function cached<T>(key: string, fn: () => T): T {
  const hit = memo.get(key);
  if (hit && hit.v === S.version && Date.now() - hit.at < 300e3) return hit.val;
  const val = fn();
  memo.set(key, { v: S.version, at: Date.now(), val });
  return val;
}
const invalidate = () => { memo.clear(); S.version++; };

// ---------------------------------------------------------------- settings
function settings(): Required<Pick<Settings, "rules" | "thresholds" | "dam">> & Settings {
  const s = S.settings || {};
  return { ...s, rules: s.rules ?? DEFAULT_RULES, thresholds: s.thresholds ?? {}, dam: s.dam ?? [] };
}
async function saveSettings(patch: Partial<Settings>) {
  let key = localStorage.getItem("adminKey");
  if (!key) {
    key = window.prompt("Clave de administrador (ADMIN_KEY configurada en Netlify):") || "";
    if (!key) throw new Error("Se necesita la clave para guardar cambios");
  }
  await loadSettings(); // partir de lo último guardado
  const body = { ...settings(), ...patch };
  const r = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json", "x-admin-key": key }, body: JSON.stringify(body) });
  const res = await r.json().catch(() => ({}));
  if (r.status === 401) { localStorage.removeItem("adminKey"); throw new Error("Clave incorrecta"); }
  if (!r.ok) throw new Error(res.error || `HTTP ${r.status}`);
  localStorage.setItem("adminKey", key);
  S.settings = res;
  invalidate();
  return res;
}

// ---------------------------------------------------------------- estaciones
function seriesInfo(key: string) {
  const sd = S.stations.find((s) => s.key === key)!;
  return sd.series.map((d) => {
    const st = S.series.get(d.id);
    const lt = st?.obs.length ? iso(st.obs[st.obs.length - 1].t) : null;
    return { id: d.id, role: d.role, var_code: st?.meta?.var?.var ?? null, var_name: st?.meta?.var?.nombre ?? null, unit: st?.unit ?? null,
      verify_status: st?.verify ?? (d.role === "level_hist" ? "a pedido" : "pending"), verify_detail: st?.verify_detail ?? null,
      last_obs_ts: lt, last_obs_local: localStr(lt), source_url: sourceUrl(d.id),
      last_fetch_status: st?.verify === "error" ? "error" : st ? "ok" : null, last_error: st?.error ?? null, fetched_at: st?.fetched_at ?? null };
  });
}

function stationStats(key: string) {
  return cached(`stats:${key}`, () => an.stationStats(usable(key)));
}

function stationSummary(key: string): Station {
  const sd = S.stations.find((s) => s.key === key)!;
  const series = seriesInfo(key);
  const roles = new Set(sd.series.map((s) => s.role));
  const lvl = sd.series.find((s) => s.role === "level");
  const out: any = { ...sd, ina_name: seriesOf(key, "level")?.meta?.estacion?.nombre ?? null, main: sd.main ? 1 : 0, near_hydro: sd.near_hydro ?? null,
    series, has_level: roles.has("level"), has_rain: roles.has("rain"), has_discharge: roles.has("discharge"),
    source: { name: "INA", url: sourceUrl((lvl || sd.series[0]).id) }, discharge: null,
    discharge_note: roles.has("discharge") ? null : "Sin datos públicos de caudal: el INA tiene la serie Q definida pero vacía, y no hay curva de gasto oficial publicada." };
  if (roles.has("level")) {
    const recent = usable(key, "level", Date.now() - 45 * D);
    const stats = stationStats(key);
    out.level = recent.length ? { value: recent[recent.length - 1][1], unit: "m", ts: iso(recent[recent.length - 1][0]),
      ts_local: localStr(recent[recent.length - 1][0]), changes: an.changes(recent), measured: true } : null;
    out.status = an.stationStatus(recent, stats, settings().thresholds[key]?.crecida_m);
    out.stats_brief = stats.available ? { avg_7d: stats.windows["7d"].mean, avg_30d: stats.windows["30d"].mean, avg_365d: stats.windows["365d"].mean,
      p90_hist: stats.windows.historico.p90, history_days: stats.history_days, comparisons: stats.comparisons, same_month_mean: stats.same_month_climatology.mean } : null;
    out.flood = an.floodDetection(sd.name, recent);
    const wk = recent.filter(([t]) => t >= Date.now() - 7 * D);
    const step = Math.max(1, Math.ceil(wk.length / 120));
    out.spark = wk.filter((_, i) => i % step === 0 || i === wk.length - 1);
  }
  if (roles.has("rain")) out.rain = rainSummaryOf(key);
  return out as Station;
}

function rainSummaryOf(key: string) {
  const pts = usable(key, "rain", Date.now() - 62 * D);
  const r = an.rainSummary(pts, lastTs(key, "rain"));
  r.last_local = localStr(r.last_ts);
  return r;
}

const orderedStations = () => [...S.stations].sort((a, b) => (a.chain_order ?? 99) - (b.chain_order ?? 99) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

// ---------------------------------------------------------------- propagación / alertas
function prop() {
  return cached("prop", () => {
    const chain = S.stations.filter((s) => s.kind === "hydro" && s.chain_order != null).sort((a, b) => a.chain_order! - b.chain_order!);
    const data: Record<string, P[]> = {};
    for (const s of chain) data[s.key] = usable(s.key);
    return an.propagation(chain.map((s) => ({ key: s.key, name: s.name })), data);
  });
}

function evalAlerts() {
  return cached("alerts", () => {
    const names: Record<string, string> = Object.fromEntries(S.stations.map((s) => [s.key, s.name]));
    const acks: Record<string, boolean> = JSON.parse(localStorage.getItem("acks") || "{}");
    const out: any[] = [];
    for (const rule of settings().rules.filter((r: any) => r.enabled)) {
      const p = rule.params || {};
      const push = (k: string, message: string, value: number, dataTs: string | null) => {
        const id = `${rule.id}:${k}:${message.replace(/[\d.,+−-]+/g, "")}`;
        out.push({ id, rule_id: rule.id, station_key: k, message, value, type: rule.type, rule_description: rule.description,
          data_ts: dataTs, data_local: localStr(dataTs), triggered_local: localStr(Date.now()), cleared_at: null, acknowledged: acks[id] ? 1 : 0 });
      };
      if (["rise", "above_avg", "trend", "stale"].includes(rule.type)) {
        const keys = rule.station_key ? [rule.station_key] : S.stations.filter((s) => s.series.some((x) => x.role === "level")).map((s) => s.key);
        for (const k of keys) {
          const pts = usable(k, "level", Date.now() - 40 * D);
          if (!pts.length) continue;
          const [tl, vl] = pts[pts.length - 1];
          const name = names[k] || k;
          if (rule.type === "rise") {
            const h = Number(p.hours ?? 6);
            const ref = an.valueAt(pts, tl - h * H, Math.max(1, h * 0.35));
            if (ref && (vl - ref[1]) * 100 > Number(p.cm ?? 10)) push(k, `${name} subió ${Math.round((vl - ref[1]) * 100)} cm en ${h} h.`, (vl - ref[1]) * 100, iso(tl));
          } else if (rule.type === "above_avg") {
            const days = Number(p.days ?? 30);
            const dm = an.dailyMeans(pts.filter(([t]) => t >= tl - (days + 1) * D));
            const today = localDate(Date.now());
            const means = [...dm.entries()].filter(([d]) => d < today).map(([, x]) => x.mean).slice(-days);
            if (means.length >= Math.max(3, Math.floor(days / 2))) {
              const avg = means.reduce((a, b) => a + b, 0) / means.length;
              if (vl > avg) push(k, `${name} supera el promedio de ${days} días (${vl.toFixed(2)} m vs ${avg.toFixed(2)} m).`, (vl - avg) * 100, iso(tl));
            }
          } else if (rule.type === "trend") {
            const tr = an.trend(pts);
            const want = p.direction || "SUBIENDO";
            if (tr.label === want) push(k, `${name} ${want === "SUBIENDO" ? "está creciendo" : "está bajando"} (${tr.cm_per_day! > 0 ? "+" : ""}${tr.cm_per_day!.toFixed(1)} cm/día).`, tr.cm_per_day!, iso(tl));
          } else {
            const age = (Date.now() - tl) / H;
            if (age > Number(p.hours ?? 12)) push(k, `${name} sin actualizar hace ${Math.round(age)} h.`, age, iso(tl));
          }
        }
      } else if (rule.type === "propagation") {
        for (const sig of prop().signals) for (const d of sig.downstream) {
          if ((!rule.station_key || d.to === rule.station_key) && !d.already_rising && d.hours_from_now[1] >= 0) {
            const [a, b] = d.hours_from_now;
            push(d.to, `${d.to_name} podría recibir la señal de subida detectada en ${sig.name} en ~${Math.round(Math.max(a, 0))}–${Math.round(b)} h (estimación estadística).`, b, sig.onset);
          }
        }
      } else if (rule.type === "rain") {
        const h = Number(p.hours ?? 24);
        const keys = rule.station_key ? [rule.station_key] : S.stations.filter((s) => s.series.some((x) => x.role === "rain")).map((s) => s.key);
        for (const k of keys) {
          const pts = usable(k, "rain", Date.now() - h * H);
          if (!pts.length) continue;
          const mm = pts.reduce((a, [, v]) => a + v, 0);
          if (mm > Number(p.mm ?? 20)) push(k, `Lluvia acumulada en ${names[k] || k}: ${mm.toFixed(1)} mm en ${h} h.`, mm, iso(pts[pts.length - 1][0]));
        }
      }
    }
    return out;
  });
}

export const RULE_TYPES = {
  rise: { params: { cm: "float", hours: "float" }, help: "Subió más de <cm> en <hours> horas" },
  above_avg: { params: { days: "int" }, help: "Nivel actual por encima del promedio de <days> días" },
  trend: { params: { direction: "SUBIENDO|BAJANDO" }, help: "La tendencia es <direction>" },
  propagation: { params: {}, help: "Hay una señal de subida aguas arriba que podría llegar a esta estación" },
  rain: { params: { mm: "float", hours: "float" }, help: "Lluvia acumulada > <mm> en <hours> horas (vacío = cualquier estación)" },
  stale: { params: { hours: "float" }, help: "La estación no actualiza hace más de <hours> horas" },
};

// ---------------------------------------------------------------- export
function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- API pública (misma forma que la versión con backend)
export const api = {
  async stations(): Promise<Station[]> {
    await loadAll();
    return orderedStations().map((s) => stationSummary(s.key));
  },
  async status() {
    await loadAll();
    const series = S.stations.flatMap((s) => seriesInfo(s.key).map((x) => ({ ...x, station_key: s.key }))).map((x) => {
      const age = x.last_obs_ts ? (Date.now() - Date.parse(x.last_obs_ts)) / H : null;
      return { ...x, age_hours: age == null ? null : Math.round(age * 10) / 10, stale: age == null || age > CFG.staleHours };
    });
    const lvl = series.filter((x) => x.role === "level");
    const fresh = lvl.filter((x) => !x.stale).length;
    const lastData = lvl.map((x) => x.last_obs_ts).filter(Boolean).sort().pop() || null;
    const overall = !S.loadedAt ? { code: "init", emoji: "⚪", label: "Cargando datos del INA" }
      : S.lastError && !fresh ? { code: "error", emoji: "🔴", label: "Sin conexión con el INA" }
      : fresh < lvl.length ? { code: "partial", emoji: "🟠", label: `${fresh}/${lvl.length} estaciones actualizadas` }
      : { code: "ok", emoji: "🟢", label: "Todas las estaciones actualizadas" };
    const at = S.loadedAt ? iso(S.loadedAt) : null;
    return { mode: "REAL DATA", overall, now: iso(Date.now()), last_data_ts: lastData, last_data_local: localStr(lastData),
      collector: { enabled: true, poll_minutes: 10, running: S.loading, last_cycle: at ? { at } : null, next_cycle: S.loadedAt ? iso(S.loadedAt + 600e3) : null,
        last_cycle_error: S.lastError }, series };
  },
  async stats(k: string): Promise<Stats> { await loadAll(); return stationStats(k); },
  async history(k: string, from: string, agg = "raw", variable = "level") {
    await loadAll();
    const since = Date.parse(from);
    if (variable === "rain") {
      if (agg === "daily") return { unit: "mm", data: an.rainDaily(usable(k, "rain"), since) };
      const st = seriesOf(k, "rain");
      return { unit: "mm", data: (st?.obs || []).filter((o) => o.t >= since).map((o) => ({ ts: iso(o.t), value: o.v, quality: o.q, source: "INA" })) };
    }
    if (variable === "level_hist") {
      const obs = await loadHist(k);
      const pts: P[] = obs.filter((o) => o.q === "VALID" && o.v !== null && o.t >= since).map((o) => [o.t, o.v as number]);
      return { unit: "m", data: [...an.dailyMeans(pts).entries()].map(([date, v]) => ({ date, ...v })) };
    }
    if (agg === "daily") return { unit: "m", data: [...an.dailyMeans(usable(k, "level", since)).entries()].map(([date, v]) => ({ date, ...v })) };
    const st = seriesOf(k, "level");
    let rows = (st?.obs || []).filter((o) => o.t >= since && o.v !== null).map((o) => ({ ts: iso(o.t), value: o.v, quality: o.q, quality_note: o.note, source: "INA" }));
    if (rows.length > 6000) { const step = Math.ceil(rows.length / 5000); rows = rows.filter((_, i) => i % step === 0 || i === rows.length - 1); }
    return { unit: "m", data: rows };
  },
  async quality(k: string) {
    await loadAll();
    const st = seriesOf(k, "level");
    const obs = st?.obs || [];
    const counts: Record<string, number> = {};
    for (const o of obs) counts[o.q] = (counts[o.q] || 0) + 1;
    const recent = obs.filter((o) => o.t >= Date.now() - 90 * D);
    const dts = recent.slice(1).map((o, i) => (o.t - recent[i].t) / H);
    const med = dts.length ? [...dts].sort((a, b) => a - b)[Math.floor(dts.length / 2)] : null;
    const gaps = med == null ? [] : dts.map((d, i) => ({ d, i })).filter((x) => x.d > Math.max(3 * med, 8))
      .map((x) => ({ from: iso(recent[x.i].t), to: iso(recent[x.i + 1].t), hours: Math.round(x.d * 10) / 10 }));
    return { measurements: Object.entries(counts).map(([quality, n]) => ({ quality, n })), issues: (st?.issues || []).slice(-200).reverse().map((x, i) => ({ id: i, ...x })),
      revisions: [], gaps_90d: gaps, typical_step_h: med == null ? null : Math.round(med * 100) / 100 };
  },
  async rainfall() {
    await loadAll();
    return cached("rainfall", () => {
      const list = orderedStations().filter((s) => s.series.some((x) => x.role === "rain"));
      const stations = list.map((s) => ({ key: s.key, name: s.name, lat: s.lat, lon: s.lon, kind: s.kind,
        near_hydro: s.kind === "hydro" ? s.key : s.near_hydro ?? null, source_url: sourceUrl(s.series.find((x) => x.role === "rain")!.id), ...rainSummaryOf(s.key) }));
      const response = stations.map((st) => {
        const mm72 = st.windows["72h"].mm;
        const hydro = st.near_hydro;
        const item: any = { rain_station: st.key, rain_name: st.name, hydro_station: hydro, rain_72h_mm: mm72 };
        if (mm72 == null) return { ...item, status: "sin_datos", message: `${st.name}: sin datos de lluvia recientes.` };
        if (mm72 < CFG.rainResponseMinMm) return { ...item, status: "sin_lluvia_relevante", message: `${st.name}: ${mm72.toFixed(1)} mm en 72 h (bajo el mínimo configurado de ${CFG.rainResponseMinMm} mm).` };
        if (!hydro) return { ...item, status: "sin_estacion_hidro", message: `${st.name}: ${mm72.toFixed(1)} mm en 72 h; no hay estación de nivel asociada.` };
        const pts = usable(hydro, "level", Date.now() - 5 * D);
        const first = usable(st.key, "rain", Date.now() - 72 * H).find(([, v]) => v > 0);
        if (!pts.length || !first) return { ...item, status: "sin_datos", message: `${st.name}: ${mm72.toFixed(1)} mm en 72 h; sin datos de nivel para comparar.` };
        const before = an.valueAt(pts, first[0], 6);
        const rise = before ? pts[pts.length - 1][1] - before[1] : null;
        if (rise != null && rise >= 0.03) return { ...item, status: "respuesta", message: `${st.name}: ${mm72.toFixed(1)} mm en 72 h y el nivel subió ${Math.round(rise * 100)} cm desde el inicio de la lluvia. Posible respuesta hidrológica.` };
        return { ...item, status: "sin_respuesta_visible", message: `${st.name}: ${mm72.toFixed(1)} mm en 72 h; todavía sin subida visible del nivel.` };
      });
      return { stations, response, note: "Acumulados = suma de la precipitación por intervalo nativo (Pi) del INA. Si una estación no tiene datos en la ventana se muestra 'sin datos', nunca 0 mm." };
    });
  },
  async rainMonthly(k: string) { await loadAll(); return an.rainMonthly(usable(k, "rain")); },
  async propagation() { await loadAll(); return prop(); },
  async floods() {
    await loadAll();
    return cached("floods", () => orderedStations().filter((s) => s.series.some((x) => x.role === "level"))
      .map((s) => ({ key: s.key, name: s.name, ...an.floodDetection(s.name, usable(s.key, "level", Date.now() - 45 * D)) })).filter((x) => x.available));
  },
  async dam() {
    await loadAll();
    const cfg = settings();
    const UNITS: Record<string, string> = { cota: "m", volumen: "hm³", almacenamiento_pct: "%", caudal_entrante: "m³/s", caudal_saliente: "m³/s", generacion: "MW" };
    const out: any = { name: "Dique Florentino Ameghino", lat: -43.698, lon: -66.475,
      public_source_note: "No se encontró una fuente pública estructurada (API/series) para cota, volumen, caudales ni generación del embalse. El INA publica solo la escala del río AGUAS ABAJO del dique. Los valores del embalse se pueden cargar manualmente desde comunicados oficiales (p.ej. IPA Chubut) y se muestran como MANUAL con su fuente.",
      cota_max_normal: cfg.dam_limits?.cota_max_normal ?? null, cota_min_operativa: cfg.dam_limits?.cota_min_operativa ?? null, variables: {} };
    for (const [v, unit] of Object.entries(UNITS)) {
      const rows = cfg.dam.filter((r: any) => r.variable === v).sort((a: any, b: any) => a.ts.localeCompare(b.ts));
      if (!rows.length) { out.variables[v] = { available: false, unit, message: "Sin datos públicos disponibles." }; continue; }
      const last = rows[rows.length - 1];
      const tl = Date.parse(last.ts);
      const pts: P[] = rows.map((r: any) => [Date.parse(r.ts), r.value]);
      const ch: Record<string, number | null> = {};
      for (const [k, h, tol] of [["24h", 24, 12], ["7d", 168, 48], ["30d", 720, 120]] as const) {
        const ref = an.valueAt(pts, tl - h * H, tol);
        ch[k] = ref ? Math.round((last.value - ref[1]) * 1000) / 1000 : null;
      }
      out.variables[v] = { available: true, unit, last: { ...last, ts_local: localStr(last.ts) }, age_days: Math.round(((Date.now() - tl) / D) * 10) / 10, changes: ch };
    }
    const vin = out.variables.caudal_entrante, vout = out.variables.caudal_saliente;
    out.balance = vin.available && vout.available
      ? { available: true, estimated: true, q_in: vin.last.value, q_out: vout.last.value, delta_storage_hm3_day: Math.round(((vin.last.value - vout.last.value) * 86400) / 1e3) / 1e3,
          note: "ESTIMADO: ΔS = (Qentrada − Qsalida) × 86400 s. No incluye evaporación ni infiltración." }
      : { available: false, note: "No se puede calcular el balance: no hay caudales públicos de entrada ni de salida. El nivel de Las Plumas indica cualitativamente el aporte del río, pero sin curva de gasto no se convierte a m³/s." };
    return out;
  },
  async addDam(b: any) {
    const UNITS: Record<string, string> = { cota: "m", volumen: "hm³", almacenamiento_pct: "%", caudal_entrante: "m³/s", caudal_saliente: "m³/s", generacion: "MW" };
    const value = Number(String(b.value).replace(",", "."));
    if (!b.source || !b.ts || Number.isNaN(value)) throw new Error("Se requieren fecha, valor numérico y fuente.");
    const ts = b.ts.length === 10 ? `${b.ts}T12:00:00-03:00` : b.ts;
    const row = { id: Date.now(), ts: new Date(ts).toISOString(), variable: b.variable, value, unit: UNITS[b.variable], source: b.source,
      source_url: b.source_url || null, note: b.note || null, quality: "MANUAL", entered_at: new Date().toISOString() };
    return saveSettings({ dam: [...settings().dam, row] });
  },
  async delDam(id: number) { return saveSettings({ dam: settings().dam.filter((r: any) => r.id !== id) }); },
  async alerts() { await loadAll(); return evalAlerts(); },
  async ack(id: string | number) {
    const acks = JSON.parse(localStorage.getItem("acks") || "{}");
    acks[id] = true;
    localStorage.setItem("acks", JSON.stringify(acks));
    memo.delete("alerts");
  },
  async rules() { return { rules: settings().rules, types: RULE_TYPES }; },
  async saveRule(r: any) {
    const rules = [...settings().rules];
    const clean = { ...r, enabled: r.enabled ? 1 : 0, description: r.description || (RULE_TYPES as any)[r.type]?.help };
    if (r.id) { const i = rules.findIndex((x: any) => x.id === r.id); if (i >= 0) rules[i] = clean; else rules.push(clean); }
    else rules.push({ ...clean, id: Math.max(0, ...rules.map((x: any) => x.id)) + 1 });
    return saveSettings({ rules });
  },
  async delRule(id: number) { return saveSettings({ rules: settings().rules.filter((x: any) => x.id !== id) }); },
  async thresholds() { return settings().thresholds; },
  async setThreshold(k: string, v: string) {
    const th = { ...settings().thresholds };
    if (v === "" || v == null) delete th[k];
    else { const n = Number(String(v).replace(",", ".")); if (Number.isNaN(n)) throw new Error("valor inválido"); th[k] = { crecida_m: n }; }
    await saveSettings({ thresholds: th });
    return th;
  },
  async discovery() {
    const d = S.settings.discovery;
    const known = new Set(S.stations.flatMap((s) => s.series.map((x) => x.id)));
    const ignored = new Set(S.settings.ignored_series || []);
    const cands = (d?.candidates || []).map((c: any) => ({ ...c, source_url: sourceUrl(c.series_id), status: known.has(c.series_id) ? "enabled" : ignored.has(c.series_id) ? "ignored" : "new" }));
    return { last_run: d?.last_run ?? null, candidates: cands,
      note: "Series encontradas automáticamente en la zona. NO se agregan solas: verificá que la estación esté en la cuenca aportante al Ameghino." };
  },
  async runDiscovery() {
    const cfg = (seed as any).discovery;
    const known = new Set(S.stations.flatMap((s) => s.series.map((x) => x.id)));
    const cands: Record<number, any> = {};
    for (const term of cfg.search_terms) {
      let ests: any[] = [];
      try { ests = await (await fetch(`/api/ina/estaciones/${encodeURIComponent(term)}`)).json(); } catch { continue; }
      for (const e of Array.isArray(ests) ? ests : []) {
        if (cfg.exclude_station_ids.includes(e.id) || !e.has_obs) continue;
        const [lon, lat] = e.geom?.coordinates || [];
        const b = cfg.bbox;
        if (lat == null || lat < b.min_lat || lat > b.max_lat || lon < b.min_lon || lon > b.max_lon) continue;
        let rows: any = [];
        try { rows = await (await fetch(`/api/ina/series-estacion/${e.id}`)).json(); } catch { continue; }
        for (const r of rows?.rows || rows || []) {
          const v = r.var || {};
          if (![2, 4, 27, 39].includes(v.id) || !r.date_range?.timeend || known.has(r.id)) continue;
          cands[r.id] = { series_id: r.id, ina_station_id: e.id, station_name: e.nombre, lat, lon, var_id: v.id, var_code: v.var, var_name: v.nombre,
            unit: r.unidades?.abrev, timestart: r.date_range.timestart, timeend: r.date_range.timeend, count: r.date_range.count, availability: r.date_range.data_availability };
        }
      }
    }
    await saveSettings({ discovery: { last_run: new Date().toISOString(), candidates: Object.values(cands) } });
    return { status: "ok" };
  },
  async enableDiscovered(id: number) {
    const c = (S.settings.discovery?.candidates || []).find((x: any) => x.series_id === id);
    if (!c) throw new Error("candidato no encontrado");
    const role = ({ 2: "level", 4: "discharge", 27: "rain", 39: "level_hist" } as any)[c.var_id];
    const existing = S.stations.find((s) => s.ina_station_id === c.ina_station_id);
    const extra = { series_id: id, station_key: existing?.key || `ina_${c.ina_station_id}`, role, var_id: c.var_id, ina_station_id: c.ina_station_id,
      name: c.station_name, lat: c.lat, lon: c.lon };
    await saveSettings({ extra_series: [...(S.settings.extra_series || []), extra] });
    await loadAll(true);
    return extra;
  },
  async ignoreDiscovered(id: number) { return saveSettings({ ignored_series: [...(S.settings.ignored_series || []), id] }); },
  async forecast() {
    const bucket = Math.floor(Date.now() / 1800e3);
    const r = await fetch(`/api/forecast/${bucket}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  },
  async collect() { await loadAll(true); return { status: "datos actualizados" }; },
  async exportData(k: string, variable: string, from: string, to: string, fmt: string) {
    await loadAll();
    const role = variable === "rain" ? "rain" : variable === "level_hist" ? "level_hist" : "level";
    if (role === "level_hist") await loadHist(k);
    const st = seriesOf(k, role);
    const t0 = Date.parse(`${from}T00:00:00-03:00`), t1 = Date.parse(`${to}T23:59:59-03:00`);
    const rows = (st?.obs || []).filter((o) => o.t >= t0 && o.t <= t1).map((o) => ({ station_key: k, series_id: st!.def.id, ts_utc: iso(o.t), ts_local: localStr(o.t),
      variable: role, value: o.v, unit: st!.unit, quality: o.q, quality_note: o.note || "", source: "INA – alerta.ina.gob.ar" }));
    const name = `${k}_${role}_${from.replace(/-/g, "")}_${to.replace(/-/g, "")}`;
    if (fmt === "json") download(`${name}.json`, new Blob([JSON.stringify({ station: k, source: "INA – https://alerta.ina.gob.ar/a5", from, to, rows }, null, 1)], { type: "application/json" }));
    else if (fmt === "xlsx") {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "datos");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Estación", k], ["Serie INA", st?.def.id ?? ""], ["Fuente", "INA – https://alerta.ina.gob.ar/a5"], ["Desde", from], ["Hasta", to], ["Exportado", new Date().toISOString()]]), "fuente");
      download(`${name}.xlsx`, new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    } else {
      const cols = ["station_key", "series_id", "ts_utc", "ts_local", "variable", "value", "unit", "quality", "quality_note", "source"];
      const csv = [cols.join(","), ...rows.map((r: any) => cols.map((c) => { const v = r[c] ?? ""; return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v; }).join(","))].join("\n");
      download(`${name}.csv`, new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    }
    return rows.length;
  },
};
