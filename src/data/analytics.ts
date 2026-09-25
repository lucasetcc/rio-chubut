/** Cálculos sobre datos reales. Si falta un dato, el resultado es null con una razón.
 *  Todo lo que devuelve este módulo es CALCULADO o ESTIMADO (nunca oficial). */

export type P = [number, number]; // [ms UTC, valor]
export const H = 3600e3;
export const D = 86400e3;

export const CFG = {
  trendCmDay: 3,            // pendiente mínima (cm/día) para hablar de subida/bajada
  trendMinDeltaCm: 3,       // y además cambio real ≥ 3 cm en 24 h (resolución del INA: 1 cm)
  staleHours: 24,           // dato más viejo que esto = "sin actualizar": no se calcula estado ni mensajes
  rapidRiseCm6h: 5,
  sustainedRiseCm24h: 5,
  propagationDays: 365,
  propagationMaxLagH: 120,
  propagationMinR: 0.6,     // sólo se estiman tiempos de llegada con correlación alta
  rainResponseMinMm: 5,
  suspectJumpM: 1.5,
  levelMin: -5,
  levelMax: 25,
  rainMaxStep: 150,
  minCoverage: 0.7,         // un promedio de N días exige datos en ≥70 % de los días
  climMinYears: 3,          // "normal" = mismo mes de ≥3 años anteriores
  climMinDays: 60,
};

/** Argentina no usa horario de verano desde 2009: UTC−3 fijo. */
export const localDate = (ms: number) => new Date(ms - 3 * H).toISOString().slice(0, 10);
export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function minMax(a: number[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

export function valueAt(pts: P[], t: number, tolH: number): P | null {
  let lo = 0, hi = pts.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] < t) lo = m + 1; else hi = m; }
  let best: P | null = null, bd = Infinity;
  for (const i of [lo - 1, lo]) {
    if (i >= 0 && i < pts.length) {
      const d = Math.abs(pts[i][0] - t) / H;
      if (d <= tolH && d < bd) { bd = d; best = pts[i]; }
    }
  }
  return best;
}

export function percentile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = ((sorted.length - 1) * q) / 100;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type Describe = { n: number; mean: number | null; min: number | null; max: number | null; median: number | null;
  p10: number | null; p25: number | null; p75: number | null; p90: number | null; days_with_data?: number; days_expected?: number; since?: string;
  insufficient?: boolean };

export function describe(vals: number[]): Describe {
  if (!vals.length) return { n: 0, mean: null, min: null, max: null, median: null, p10: null, p25: null, p75: null, p90: null };
  const s = [...vals].sort((a, b) => a - b);
  return { n: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, min: s[0], max: s[s.length - 1],
    median: percentile(s, 50), p10: percentile(s, 10), p25: percentile(s, 25), p75: percentile(s, 75), p90: percentile(s, 90) };
}

export type Day = { mean: number; n: number; min: number; max: number };
export function dailyMeans(pts: P[]): Map<string, Day> {
  const g = new Map<string, number[]>();
  for (const [t, v] of pts) { const d = localDate(t); let a = g.get(d); if (!a) g.set(d, (a = [])); a.push(v); }
  const out = new Map<string, Day>();
  [...g.keys()].sort().forEach((d) => { const a = g.get(d)!; const [lo, hi] = minMax(a); out.set(d, { mean: a.reduce((x, y) => x + y, 0) / a.length, n: a.length, min: lo, max: hi }); });
  return out;
}

const CHANGE_WINDOWS: Record<string, [number, number]> = { "1h": [1, 0.6], "6h": [6, 2.1], "12h": [12, 2.1], "24h": [24, 3], "7d": [168, 12], "30d": [720, 24] };

export type Change = { delta_m: number | null; ref_ts?: string; ref_value?: number; reason?: string };
/** Cambios respecto del ÚLTIMO dato (el que se muestra con su fecha). Quien los muestre debe mostrar esa fecha. */
export function changes(pts: P[]): Record<string, Change> {
  if (!pts.length) return {};
  const [tl, vl] = pts[pts.length - 1];
  const out: Record<string, Change> = {};
  for (const [k, [h, tol]] of Object.entries(CHANGE_WINDOWS)) {
    const ref = valueAt(pts, tl - h * H, tol);
    out[k] = ref ? { delta_m: Math.round((vl - ref[1]) * 1e4) / 1e4, ref_ts: iso(ref[0]), ref_value: ref[1] }
      : { delta_m: null, reason: "sin dato de referencia en la ventana (resolución de la serie)" };
  }
  return out;
}

export type Trend = { label: string; cm_per_day: number | null; threshold_cm_day?: number; n?: number; reason?: string; significant?: boolean };
/** Pendiente de las últimas 24 h de datos. Sólo SUBIENDO/BAJANDO si es significativa (>2 errores estándar)
 *  y además el cambio real en 24 h es ≥ 3 cm (evita cambios de etiqueta por el redondeo de 1 cm del sensor). */
export function trend(pts: P[]): Trend {
  if (!pts.length) return { label: "SIN DATOS", cm_per_day: null };
  const tl = pts[pts.length - 1][0];
  const w = pts.filter(([t]) => t >= tl - 24 * H);
  if (w.length < 3 || w[w.length - 1][0] - w[0][0] < 8 * H) return { label: "INDETERMINADA", cm_per_day: null, reason: "menos de 3 datos en 24 h" };
  const x = w.map(([t]) => (t - w[0][0]) / D), y = w.map(([, v]) => v);
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const b = den ? num / den : 0;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - (my + b * (x[i] - mx))) ** 2;
  const se = n > 2 && den ? Math.sqrt(sse / (n - 2) / den) * 100 : Infinity; // cm/día
  const slope = b * 100;
  const d24 = (w[w.length - 1][1] - w[0][1]) * 100;
  const th = CFG.trendCmDay;
  const sig = Math.abs(slope) >= th && Math.abs(slope) > 2 * se && Math.abs(d24) >= CFG.trendMinDeltaCm;
  return { label: !sig ? "ESTABLE" : slope > 0 ? "SUBIENDO" : "BAJANDO", cm_per_day: Math.round(slope * 100) / 100, threshold_cm_day: th, n, significant: sig };
}

// ------------------------------------------------------------------ estadísticas
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function stationStats(pts: P[], now = Date.now()) {
  if (!pts.length) return { available: false, reason: "sin datos" } as any;
  const today = localDate(now);
  const dm = dailyMeans(pts);
  const days = [...dm.keys()];
  const complete = days.filter((d) => d < today);
  const [ct, cv] = pts[pts.length - 1];
  const winDays = (n: number, inclToday: boolean) => {
    const start = localDate(now - (inclToday ? n - 1 : n) * D);
    return days.filter((d) => d >= start && (inclToday || d < today));
  };
  const win = (sel: string[], n: number): Describe => {
    const ok = sel.length >= Math.ceil(CFG.minCoverage * n);
    return { ...describe(ok ? sel.map((d) => dm.get(d)!.mean) : []), days_with_data: sel.length, days_expected: n, insufficient: !ok };
  };
  const windows: Record<string, Describe> = {};
  for (const n of [7, 30, 90, 365]) windows[`${n}d`] = win(winDays(n, false), n);
  windows["7d_incl_hoy"] = win(winDays(7, true), 7);
  windows["24h"] = describe(pts.filter(([t]) => t >= ct - 24 * H).map(([, v]) => v));
  windows["historico"] = { ...describe(complete.map((d) => dm.get(d)!.mean)), days_with_data: complete.length, since: iso(pts[0][0]) };

  // "Normal" = mismo mes calendario de años ANTERIORES (el río es estacional). Exige ≥3 años.
  const month = Number(localDate(ct).slice(5, 7)), year = Number(localDate(ct).slice(0, 4));
  const sm = complete.filter((d) => Number(d.slice(5, 7)) === month && Number(d.slice(0, 4)) < year);
  const years = [...new Set(sm.map((d) => d.slice(0, 4)))].sort();
  const smVals = sm.map((d) => dm.get(d)!.mean).sort((a, b) => a - b);
  const climOk = years.length >= CFG.climMinYears && smVals.length >= CFG.climMinDays;
  let rank: number | null = null;
  if (climOk) { let c = 0; for (const v of smVals) if (v <= cv) c++; rank = Math.round((1000 * c) / smVals.length) / 10; }
  const clim = { ...describe(smVals), years, month, month_name: MONTHS[month - 1], ok: climOk,
    reason: climOk ? null : `se necesitan ≥${CFG.climMinYears} años de ${MONTHS[month - 1]} (hay ${years.length})` };

  const comparisons: Record<string, number | null> = {};
  for (const k of ["7d", "7d_incl_hoy", "30d", "90d", "365d", "historico"]) {
    const m = windows[k].mean;
    comparisons[k] = m == null ? null : Math.round((cv - m) * 1e4) / 1e4;
  }
  comparisons["mismo_mes_hist"] = climOk && clim.median != null ? Math.round((cv - clim.median) * 1e4) / 1e4 : null;
  return {
    available: true, current: { ts: iso(ct), value: cv }, today_mean: dm.get(today)?.mean ?? null, windows,
    same_month_climatology: clim, comparisons, percentile_rank_hist: rank, history_days: complete.length,
    record_since: iso(pts[0][0]),
    method: "CALCULADO. Ventanas ≥7 días: promedios diarios (días completos en hora argentina), sólo si hay datos en ≥70 % de los días. " +
      "Percentil: contra los promedios diarios del mismo mes en años anteriores (≥3 años). Solo datos VALID.",
  };
}

// ------------------------------------------------------------------ crecidas / estado
export function floodDetection(name: string, pts: P[], now = Date.now()) {
  if (!pts.length) return { available: false } as any;
  const [tl, vl] = pts[pts.length - 1];
  const age_h = (now - tl) / H;
  const out: any = { available: true, messages: [] as string[], age_h: Math.round(age_h * 10) / 10, last_ts: iso(tl), stale: age_h > CFG.staleHours };
  const ch = changes(pts);
  const d = (k: string) => ch[k]?.delta_m ?? null;
  const r6 = d("6h"), r12 = d("12h"), r24 = d("24h");
  out.rise_cm = Object.fromEntries(["1h", "6h", "12h", "24h", "7d", "30d"].map((k) => [k, d(k) == null ? null : Math.round(d(k)! * 1000) / 10]));
  out.rate_cm_h = r6 == null ? null : Math.round((r6 * 100 / 6) * 100) / 100;
  out.rate_cm_day = r24 == null ? null : Math.round(r24 * 1000) / 10;
  out.rapid_rise = !out.stale && r6 != null && r6 * 100 >= CFG.rapidRiseCm6h;
  const last24 = pts.filter(([t]) => t >= tl - 24 * H).map(([, v]) => v);
  const steps = last24.slice(1).map((v, i) => v - last24[i]);
  out.sustained_rise = !out.stale && !!(r24 != null && r24 * 100 >= CFG.sustainedRiseCm24h && steps.length && steps.filter((s) => s >= 0).length / steps.length >= 0.75);
  for (const [k, h] of [["24h", 24], ["7d", 168], ["30d", 720]] as const) {
    const w = pts.filter(([t]) => t >= tl - h * H);
    if (w.length) {
      let mx = w[0], mn = w[0];
      for (const p of w) { if (p[1] >= mx[1]) mx = p; if (p[1] < mn[1]) mn = p; }
      out[`max_${k}`] = { value: mx[1], ts: iso(mx[0]), is_current: mx[0] === tl };
      out[`min_${k}`] = { value: mn[1], ts: iso(mn[0]) };
    }
  }
  if (out.stale) { // con dato viejo no se emite nada en presente
    out.disclaimer = `Último dato hace ${Math.round(age_h)} h: no se evalúan subidas.`;
    return out;
  }
  const msgs: string[] = out.messages;
  if (r12 != null && r12 >= 0.01 && (out.rapid_rise || out.sustained_rise)) msgs.push(`${name} subió ${Math.round(r12 * 100)} cm en las 12 h previas al último dato.`);
  else if (r6 != null && out.rapid_rise) msgs.push(`${name} subió ${Math.round(r6 * 100)} cm en las 6 h previas al último dato.`);
  if (out.max_30d?.is_current && r24 && r24 > 0) msgs.push(`${name} está en el máximo de los últimos 30 días.`);
  else if (out.max_7d?.is_current && r24 && r24 > 0) msgs.push(`${name} está en el máximo de los últimos 7 días.`);
  const today = localDate(now);
  const dm = dailyMeans(pts.filter(([t]) => t >= tl - 31 * D));
  const means = [...dm.entries()].filter(([dd]) => dd < today).map(([, x]) => x.mean).slice(-30);
  if (means.length >= Math.ceil(CFG.minCoverage * 30)) {
    const diff = vl - means.reduce((a, b) => a + b, 0) / means.length;
    out.vs_avg30_cm = Math.round(diff * 1000) / 10;
    if (Math.abs(diff) >= 0.02) msgs.push(`El nivel de ${name} está ${Math.round(Math.abs(diff) * 100)} cm ${diff > 0 ? "por encima" : "por debajo"} del promedio de los últimos 30 días.`);
  }
  out.disclaimer = "Criterio propio (no oficial) sobre datos de nivel. Superar un promedio no implica emergencia.";
  return out;
}

export type ManualThreshold = { crecida_m: number; source?: string; url?: string } | null | undefined;

/** Estado de una estación. Orden: sin datos → SIN ACTUALIZAR → umbral cargado con fuente → tendencia.
 *  No hay umbral automático de "crecida": no existe un umbral oficial público para estas estaciones. */
export function stationStatus(recent: P[], manual: ManualThreshold, now = Date.now()) {
  if (!recent.length) return { code: "nodata", emoji: "⚪", label: "SIN DATOS" };
  const age = (now - recent[recent.length - 1][0]) / H;
  const base = { age_hours: Math.round(age * 10) / 10, stale: age > CFG.staleHours, manual_threshold_m: manual?.crecida_m ?? null };
  if (base.stale) return { ...base, code: "stale", emoji: "⚪", label: "SIN ACTUALIZAR", why: `último dato hace ${Math.round(age)} h` };
  const tr = trend(recent);
  const v = recent[recent.length - 1][1];
  if (manual && manual.source && v >= manual.crecida_m)
    return { ...base, trend: tr, code: "over", emoji: "🔴", label: "SOBRE UMBRAL", why: `≥ ${manual.crecida_m} m (umbral cargado; fuente: ${manual.source})` };
  if (tr.label === "SUBIENDO") return { ...base, trend: tr, code: "rising", emoji: "🔵", label: "SUBIENDO" };
  if (tr.label === "BAJANDO") return { ...base, trend: tr, code: "falling", emoji: "⚪", label: "BAJANDO" };
  if (tr.label === "ESTABLE") return { ...base, trend: tr, code: "stable", emoji: "🟢", label: "ESTABLE" };
  return { ...base, trend: tr, code: "unknown", emoji: "⚪", label: tr.label };
}

// ------------------------------------------------------------------ lluvia
export const RAIN_WINDOWS: Record<string, number> = { "24h": 24, "48h": 48, "72h": 72, "7d": 168, "30d": 720 };

/** Suma de registros válidos cuyo cierre cae en (start, now]. null si no hay ningún registro válido. */
export function rainSum(pts: P[], start: number, end = Infinity): { mm: number | null; n: number } {
  let s = 0, n = 0;
  for (const [t, v] of pts) if (t > start && t <= end) { s += v; n++; }
  return { mm: n ? Math.round(s * 10) / 10 : null, n };
}

/** pts: sólo registros VALID. lastValid: timestamp del último registro VALID (no de cualquier registro). */
export function rainSummary(pts: P[], lastValid: number | null, now = Date.now()) {
  const out: any = { last_ts: lastValid ? iso(lastValid) : null, windows: {} };
  for (const [k, h] of Object.entries(RAIN_WINDOWS)) {
    const start = now - h * H;
    const r = rainSum(pts, start, now);
    out.windows[k] = r.mm == null ? { mm: null, n: 0, reason: "sin registros válidos en la ventana" }
      : { ...r, partial: !!lastValid && lastValid < now - CFG.staleHours * H };
  }
  const today = localDate(now);
  const mStart = Date.parse(`${today.slice(0, 8)}01T03:00:00Z`); // 00:00 hora argentina del día 1
  out.month_to_date = rainSum(pts, mStart, now);
  out.stale = !lastValid || lastValid < now - CFG.staleHours * H;
  return out;
}

/** El valor acumula el intervalo que termina en t -> se asigna al día de (t − 1 s).
 *  Devuelve todos los días del rango: mm = null y n = 0 si ese día no hubo registros (≠ 0 mm). */
export function rainDaily(pts: P[], since: number, now = Date.now()) {
  const g = new Map<string, number[]>();
  for (const [t, v] of pts) if (t >= since) { const d = localDate(t - 1000); let a = g.get(d); if (!a) g.set(d, (a = [])); a.push(v); }
  const out: { date: string; mm: number | null; n: number }[] = [];
  for (let t = since; localDate(t) <= localDate(now); t += D) {
    const d = localDate(t), a = g.get(d);
    out.push({ date: d, mm: a ? Math.round(a.reduce((x, y) => x + y, 0) * 10) / 10 : null, n: a?.length ?? 0 });
  }
  return out;
}

export function rainMonthly(pts: P[]) {
  const g = new Map<string, number[]>();
  for (const [t, v] of pts) { const m = localDate(t - 1000).slice(0, 7); let a = g.get(m); if (!a) g.set(m, (a = [])); a.push(v); }
  return [...g.keys()].sort().map((m) => ({ month: m, mm: Math.round(g.get(m)!.reduce((a, b) => a + b, 0) * 10) / 10, n: g.get(m)!.length }));
}

// ------------------------------------------------------------------ propagación
function hourly(pts: P[], start: number, end: number, maxGapH = 12): Float64Array {
  const n = Math.floor((end - start) / H) + 1;
  const out = new Float64Array(n).fill(NaN);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = start + i * H;
    while (j < pts.length - 1 && pts[j + 1][0] < t) j++;
    const a = pts[j], b = pts[j + 1];
    if (a && a[0] === t) { out[i] = a[1]; continue; }
    if (b && b[0] === t) { out[i] = b[1]; continue; }
    if (a && b && a[0] <= t && t <= b[0] && (b[0] - a[0]) / H <= maxGapH) out[i] = a[1] + ((t - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return out;
}

export const PROP_DIFF_H = 24;

export function lagCorrelation(up: P[], down: P[], maxLag: number, diffH = PROP_DIFF_H) {
  if (up.length < 20 || down.length < 20) return { ok: false, reason: "datos insuficientes" };
  const start = Math.ceil(Math.max(up[0][0], down[0][0]) / H) * H;
  const end = Math.min(up[up.length - 1][0], down[down.length - 1][0]);
  if (end - start < 30 * D) return { ok: false, reason: "menos de 30 días de superposición" };
  const a = hourly(up, start, end), b = hourly(down, start, end);
  const da = new Float64Array(a.length - diffH), db = new Float64Array(b.length - diffH);
  for (let i = 0; i < da.length; i++) { da[i] = a[i + diffH] - a[i]; db[i] = b[i + diffH] - b[i]; }
  const res: { lag: number; r: number; n: number }[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i + lag < db.length; i++) {
      const x = da[i], y = db[i + lag];
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    if (n < 240) { res.push({ lag, r: NaN, n }); continue; }
    const cov = sxy - (sx * sy) / n, vx = sxx - (sx * sx) / n, vy = syy - (sy * sy) / n;
    res.push({ lag, r: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : NaN, n });
  }
  let best = -1;
  res.forEach((x, i) => { if (!Number.isNaN(x.r) && (best < 0 || x.r > res[best].r)) best = i; });
  if (best < 0) return { ok: false, reason: "sin superposición suficiente" };
  const rmax = res[best].r;
  const r3 = Math.round(rmax * 1000) / 1000;
  if (best >= maxLag - 3) return { ok: false, reason: `sin desfase claro dentro de 0–${maxLag} h`, r: r3 };
  if (rmax < CFG.propagationMinR) return { ok: false, reason: `correlación insuficiente (r = ${rmax.toFixed(2)}; se exige ≥ ${CFG.propagationMinR})`, r: r3 };
  let lo = best, hi = best;
  while (lo - 1 >= 0 && !Number.isNaN(res[lo - 1].r) && res[lo - 1].r >= rmax - 0.03) lo--;
  while (hi + 1 < res.length && !Number.isNaN(res[hi + 1].r) && res[hi + 1].r >= rmax - 0.03) hi++;
  return { ok: true, lag_h: best, lag_range_h: [lo, hi] as [number, number], r: r3, confidence: "alta", n_pairs: res[best].n,
    curve: res.map((x) => ({ lag_h: x.lag, r: Number.isNaN(x.r) ? null : Math.round(x.r * 1000) / 1000 })) };
}

export function riseOnset(pts: P[]): number | null {
  if (pts.length < 3) return null;
  const tl = pts[pts.length - 1][0];
  const w = pts.filter(([t]) => t >= tl - 72 * H);
  if (w.length < 3) return null;
  const [vmin] = minMax(w.map(([, v]) => v));
  let tmin = -Infinity;
  for (const [t, v] of w) if (v === vmin && t > tmin) tmin = t;
  return tmin < tl ? tmin : null;
}

export function propagation(stations: { key: string; name: string }[], data: Record<string, P[]>, now = Date.now()) {
  const since = now - CFG.propagationDays * D;
  const win: Record<string, P[]> = {};
  for (const s of stations) win[s.key] = (data[s.key] || []).filter(([t]) => t >= since);
  const chain = stations.filter((s) => win[s.key].length && now - win[s.key][win[s.key].length - 1][0] < 72 * H);
  const pairs: any[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const up = chain[i], down = chain[i + 1];
    pairs.push({ from: up.key, from_name: up.name, to: down.key, to_name: down.name, ...lagCorrelation(win[up.key], win[down.key], CFG.propagationMaxLagH) });
  }
  const signals: any[] = [];
  chain.forEach((s, i) => {
    const pts = win[s.key];
    if ((now - pts[pts.length - 1][0]) / H > CFG.staleHours) return; // dato viejo: no hay señal "actual"
    const fd = floodDetection(s.name, pts, now);
    const tr = trend(pts);
    if (!(fd.rapid_rise || fd.sustained_rise || tr.label === "SUBIENDO")) return;
    const onset = riseOnset(pts);
    if (onset == null) return;
    const [minAfter] = minMax(pts.filter(([t]) => t >= onset).map(([, v]) => v));
    const riseCm = Math.round((pts[pts.length - 1][1] - minAfter) * 1000) / 10;
    const hoursAgo = Math.round(((now - onset) / H) * 10) / 10;
    const downstream: any[] = [];
    let loAcc = 0, hiAcc = 0, broken = false;
    for (let j = i; j < chain.length - 1; j++) {
      const p = pairs[j];
      if (!p.ok) { broken = true; break; }
      loAcc += p.lag_range_h[0]; hiAcc += p.lag_range_h[1];
      const tgt = chain[j + 1];
      const etaLo = onset + loAcc * H, etaHi = onset + hiAcc * H;
      downstream.push({ to: tgt.key, to_name: tgt.name, lag_range_h: [loAcc, hiAcc], eta_from: iso(etaLo), eta_to: iso(etaHi),
        hours_from_now: [Math.round(((etaLo - now) / H) * 10) / 10, Math.round(((etaHi - now) / H) * 10) / 10],
        already_rising: trend(win[tgt.key]).label === "SUBIENDO" });
    }
    const msgs = [`Subida en ${s.name} (+${Math.round(riseCm)} cm) que empezó hace unas ${Math.round(hoursAgo)} h.`];
    for (const d of downstream) {
      const [a, b] = d.hours_from_now;
      if (d.already_rising) msgs.push(`En ${d.to_name} ya se observa subida.`);
      else if (b < 0) msgs.push(`La ventana estimada para ${d.to_name} ya pasó (${Math.round(-b)}–${Math.round(-a)} h atrás) sin subida clara.`);
      else msgs.push(`Estimación: podría empezar a notarse en ${d.to_name} en ~${Math.round(Math.max(a, 0))}–${Math.round(b)} h.`);
    }
    if (broken && !downstream.length) msgs.push("No hay correlación suficiente (r ≥ 0,6) con la estación siguiente para estimar tiempos.");
    signals.push({ station: s.key, name: s.name, onset: iso(onset), hours_ago: hoursAgo, rise_cm: riseCm, downstream, messages: msgs });
  });
  return {
    chain: chain.map((s) => ({ key: s.key, name: s.name })),
    excluded: stations.filter((s) => !chain.includes(s)).map((s) => ({ key: s.key, name: s.name, reason: "sin datos en las últimas 72 h" })),
    pairs, signals,
    method: `ESTIMADO. Correlación cruzada entre variaciones de ${PROP_DIFF_H} h del nivel (series interpoladas a grilla horaria, huecos >12 h excluidos), últimos ${CFG.propagationDays} días, desfases 0–${CFG.propagationMaxLagH} h. Sólo se informan tramos con r ≥ ${CFG.propagationMinR}. El rango X–Y h son los desfases con correlación a ≤0,03 del máximo.`,
    disclaimer: "Estimación estadística basada en el comportamiento pasado de las series. NO es una predicción hidrológica oficial.",
  };
}

/** Clase según percentil del mismo mes en años anteriores. null si no hay climatología suficiente. */
export function pctClass(p: number | null): { label: string; code: string } | null {
  if (p == null) return null;
  if (p < 10) return { label: "muy bajo", code: "vlow" };
  if (p < 25) return { label: "bajo", code: "low" };
  if (p <= 75) return { label: "normal", code: "normal" };
  if (p <= 90) return { label: "alto", code: "high" };
  return { label: "muy alto", code: "vhigh" };
}

/** Balance del embalse: sólo si entrada y salida son del mismo día. hm³/día. */
export function damBalance(qin: { value: number; ts: string } | null, qout: { value: number; ts: string } | null) {
  if (!qin || !qout) return null;
  if (qin.ts.slice(0, 10) !== qout.ts.slice(0, 10)) return null;
  return Math.round(((qin.value - qout.value) * 86400) / 1e3) / 1e3;
}
