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
  propagationDays: 3650,    // se usa toda la historia disponible (hasta 10 años)
  eventUpMinCm: 10,         // subida mínima (serie suavizada 24 h) para contar como crecida aguas arriba
  eventDownMinCm: 3,        // subida mínima aguas abajo (la onda se atenúa)
  eventMinMatches: 3,       // crecidas emparejadas mínimas para informar un tiempo de viaje
  propagationMaxLagH: 120,
  propagationMinR: 0.6,     // correlación sola: sólo con r alta
  corroborateMinR: 0.4,     // correlación que sólo confirma a las crecidas (mismo desfase)
  correlationDays: 730,     // ventana para la correlación (costo de cálculo)
  rainResponseMinMm: 5,
  suspectJumpM: 1.5,
  levelMin: -5,
  levelMax: 25,
  rainMaxStep: 150,
  minCoverage: 0.7,         // un promedio de N días exige datos en ≥70 % de los días
  climMinYears: 3,          // percentil: mismo mes de ≥3 años anteriores
  climClassMinYears: 5,     // adjetivo ("bajo", "normal"…) sólo con ≥5 años
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
  // registros típicos por día: mediana de los últimos 30 días con datos
  const perDay = new Map<string, number>();
  for (const [t] of pts) if (t > now - 30 * D) { const d = localDate(t - 1000); perDay.set(d, (perDay.get(d) || 0) + 1); }
  const counts = [...perDay.values()].sort((x, y) => x - y);
  const typical = counts.length >= 5 ? counts[Math.floor(counts.length / 2)] : null;
  out.typical_per_day = typical;
  for (const [k, h] of Object.entries(RAIN_WINDOWS)) {
    const start = now - h * H;
    const r = rainSum(pts, start, now);
    const expected = typical ? Math.max(1, Math.round((typical * h) / 24)) : null;
    out.windows[k] = r.mm == null ? { mm: null, n: 0, expected, reason: "sin registros válidos en la ventana" }
      : { ...r, expected, partial: (!!lastValid && lastValid < now - CFG.staleHours * H) || (expected != null && r.n < CFG.minCoverage * expected) };
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
  // suavizado 24 h: saca el ciclo diario del deshielo, que si no domina la correlación
  const a = smooth24(hourly(up, start, end, 30)), b = smooth24(hourly(down, start, end, 30));
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
  const curve = res.map((x) => ({ lag_h: x.lag, r: Number.isNaN(x.r) ? null : Math.round(x.r * 1000) / 1000 }));
  if (best >= maxLag - 3) return { ok: false, reason: `sin desfase claro dentro de 0–${maxLag} h`, r: r3, curve };
  if (rmax < CFG.propagationMinR) return { ok: false, reason: `correlación insuficiente (r = ${rmax.toFixed(2)}; se exige ≥ ${CFG.propagationMinR})`, r: r3, lag_h: best, curve };
  let lo = best, hi = best;
  while (lo - 1 >= 0 && !Number.isNaN(res[lo - 1].r) && res[lo - 1].r >= rmax - 0.03) lo--;
  while (hi + 1 < res.length && !Number.isNaN(res[hi + 1].r) && res[hi + 1].r >= rmax - 0.03) hi++;
  return { ok: true, lag_h: best, lag_range_h: [lo, hi] as [number, number], r: r3, confidence: "alta", n_pairs: res[best].n, curve };
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

// ---------------------------------------------------------------- tiempos de viaje por crecidas
export type RiseEvent = { onset: number; peak: number; v0: number; vp: number; rise: number };

/** Media móvil centrada de 24 h (saca el ciclo diario del deshielo). NaN si hay < 8 h con dato en la ventana. */
function smooth24(a: Float64Array): Float64Array {
  const out = new Float64Array(a.length).fill(NaN);
  let sum = 0, n = 0;
  for (let i = 0; i < a.length + 12; i++) {
    if (i < a.length && !Number.isNaN(a[i])) { sum += a[i]; n++; }
    const drop = i - 25;
    if (drop >= 0 && !Number.isNaN(a[drop])) { sum -= a[drop]; n--; }
    const c = i - 12;
    if (c >= 0 && c < a.length && n >= 8 && !Number.isNaN(a[c])) out[c] = sum / n;
  }
  return out;
}

/** Crecidas completas de una serie: pico = máximo en ±48 h, subida desde el mínimo de las 120 h previas,
 *  y bajada posterior de al menos 30 % de la subida (descarta escalones y el deshielo que sólo sube). */
export function riseEvents(pts: P[], minRiseM: number): RiseEvent[] {
  if (pts.length < 10) return [];
  const t0 = Math.ceil(pts[0][0] / H) * H;
  const raw = hourly(pts, t0, pts[pts.length - 1][0], 30);
  const sm = smooth24(raw);
  const ev: RiseEvent[] = [];
  const n = sm.length;
  for (let i = 48; i < n - 48; i++) {
    const v = sm[i];
    if (Number.isNaN(v)) continue;
    let isPeak = true, cnt = 0;
    for (let k = i - 48; k <= i + 48 && isPeak; k++) {
      if (Number.isNaN(sm[k])) continue;
      cnt++;
      if (sm[k] > v || (sm[k] === v && k < i)) isPeak = false;
    }
    if (!isPeak || cnt < 50) continue;
    let jmin = -1;
    for (let k = Math.max(0, i - 120); k < i; k++) if (!Number.isNaN(sm[k]) && (jmin < 0 || sm[k] < sm[jmin])) jmin = k;
    if (jmin < 0) continue;
    const rise = v - sm[jmin];
    if (rise < minRiseM) continue;
    let after = Infinity;
    for (let k = i; k <= Math.min(n - 1, i + 72); k++) if (!Number.isNaN(sm[k]) && sm[k] < after) after = sm[k];
    if (!(v - after >= 0.3 * rise)) continue;
    // pico real: máximo del dato horario en ±12 h del pico suavizado
    let ip = i;
    for (let k = Math.max(0, i - 12); k <= Math.min(n - 1, i + 12); k++) if (!Number.isNaN(raw[k]) && (Number.isNaN(raw[ip]) || raw[k] > raw[ip])) ip = k;
    ev.push({ onset: t0 + jmin * H, peak: t0 + ip * H, v0: sm[jmin], vp: Number.isNaN(raw[ip]) ? v : raw[ip], rise });
    i += 48;
  }
  return ev;
}

const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const quant = (a: number[], q: number) => { const b = [...a].sort((x, y) => x - y); const pos = (b.length - 1) * q, lo = Math.floor(pos); return b[lo] + (b[Math.min(lo + 1, b.length - 1)] - b[lo]) * (pos - lo); };

/** Empareja cada crecida aguas arriba con la primera crecida aguas abajo cuyo pico llega dentro de [−6 h, maxLag];
 *  segunda pasada: elige el candidato más cercano a la mediana y descarta desvíos grandes. */
export function travelTime(up: RiseEvent[], down: RiseEvent[], maxLagH: number) {
  const pass = (target: number | null) => {
    const used = new Set<number>();
    const m: { up: RiseEvent; down: RiseEvent; lag: number; onsetLag: number }[] = [];
    for (const u of up) {
      let best = -1, bestScore = Infinity;
      down.forEach((d, j) => {
        if (used.has(j)) return;
        const lag = (d.peak - u.peak) / H;
        if (lag < -6 || lag > maxLagH) return;
        const score = target == null ? lag : Math.abs(lag - target);
        if (score < bestScore) { bestScore = score; best = j; }
      });
      if (best >= 0) { used.add(best); m.push({ up: u, down: down[best], lag: (down[best].peak - u.peak) / H, onsetLag: (down[best].onset - u.onset) / H }); }
    }
    return m;
  };
  let m = pass(null);
  if (m.length >= CFG.eventMinMatches) m = pass(median(m.map((x) => x.lag)));
  if (m.length >= CFG.eventMinMatches) {
    const med = median(m.map((x) => x.lag));
    const mad = median(m.map((x) => Math.abs(x.lag - med)));
    const tol = Math.max(12, 3 * mad);
    m = m.filter((x) => Math.abs(x.lag - med) <= tol);
  }
  const events = m.map((x) => ({ up_peak: iso(x.up.peak), down_peak: iso(x.down.peak), lag_h: Math.round(x.lag), up_rise_cm: Math.round(x.up.rise * 100), down_rise_cm: Math.round(x.down.rise * 100) }));
  if (m.length < CFG.eventMinMatches)
    return { ok: false, method: "crecidas", n_events: m.length, events, reason: up.length < CFG.eventMinMatches ? `pocas crecidas registradas aguas arriba (${up.length})` : `sólo ${m.length} crecida(s) emparejada(s); se necesitan ${CFG.eventMinMatches}` };
  const lags = m.map((x) => Math.max(0, x.lag)), onsets = m.map((x) => x.onsetLag);
  const lo = Math.max(0, Math.round(quant(lags, 0.25))), hi = Math.max(lo, Math.round(quant(lags, 0.75)));
  return { ok: true, method: "crecidas", lag_h: Math.max(0, Math.round(median(lags))), lag_range_h: [lo, hi] as [number, number],
    onset_lag_h: Math.round(median(onsets)), n_events: m.length, confidence: m.length >= 8 && hi - lo <= 12 ? "alta" : "media", events };
}

/** Mezcla los dos métodos: crecidas pasadas (demora entre picos) y correlación cruzada (serie completa).
 *  - Coinciden (diferencia ≤ max(6 h, 25 %)): se promedian, confianza alta.
 *  - Sólo uno alcanza: se usa ese, confianza media (la correlación sola exige r ≥ 0,6).
 *  - No coinciden: se muestran los dos extremos como rango, confianza baja. */
export function combineMethods(ev: any, co: any) {
  const coLag: number | null = co?.lag_h ?? null;
  const coUsable = co?.ok || (coLag != null && (co.r ?? 0) >= CFG.corroborateMinR);
  const base = { n_events: ev.n_events ?? 0, events: ev.events || [], r: co?.r ?? null, corr_lag_h: coLag, curve: co?.curve || null, ev_lag_h: ev.ok ? ev.lag_h : null };
  if (ev.ok && coUsable && coLag != null) {
    const agree = Math.abs(ev.lag_h - coLag) <= Math.max(6, 0.25 * ev.lag_h);
    if (agree) {
      const lag = Math.round((ev.lag_h + coLag) / 2);
      return { ...base, ok: true, method: "crecidas + correlación", agree: true, lag_h: lag,
        lag_range_h: [Math.min(ev.lag_range_h[0], coLag), Math.max(ev.lag_range_h[1], coLag)] as [number, number],
        confidence: ev.n_events >= 5 ? "alta" : "media" };
    }
    if (ev.n_events >= 5 && !co.ok) return { ...base, ok: true, method: "crecidas", agree: false, lag_h: ev.lag_h, lag_range_h: ev.lag_range_h, confidence: "media" };
    return { ...base, ok: true, method: "crecidas + correlación", agree: false, lag_h: Math.round((ev.lag_h + coLag) / 2),
      lag_range_h: [Math.min(ev.lag_range_h[0], coLag), Math.max(ev.lag_range_h[1], coLag)] as [number, number], confidence: "baja",
      note: `los métodos no coinciden (crecidas ${ev.lag_h} h, correlación ${coLag} h)` };
  }
  if (ev.ok) return { ...base, ok: true, method: "crecidas", lag_h: ev.lag_h, lag_range_h: ev.lag_range_h, confidence: ev.confidence };
  if (co?.ok) return { ...base, ok: true, method: "correlación", lag_h: co.lag_h, lag_range_h: co.lag_range_h, confidence: "media" };
  return { ...base, ok: false, method: null, reason: `${ev.reason}; ${co?.reason || "sin correlación"}` };
}

export function propagation(stations: { key: string; name: string }[], data: Record<string, P[]>, now = Date.now()) {
  const since = now - CFG.propagationDays * D;
  const win: Record<string, P[]> = {};
  for (const s of stations) win[s.key] = (data[s.key] || []).filter(([t]) => t >= since);
  const chain = stations.filter((s) => win[s.key].length >= 10);
  const upEv: Record<string, RiseEvent[]> = {}, downEv: Record<string, RiseEvent[]> = {};
  for (const s of chain) { upEv[s.key] = riseEvents(win[s.key], CFG.eventUpMinCm / 100); downEv[s.key] = riseEvents(win[s.key], CFG.eventDownMinCm / 100); }
  const corrSince = now - CFG.correlationDays * D;
  const pairOf = (a: number, b: number) => {
    const up = chain[a], down = chain[b];
    const maxLag = Math.min(300, CFG.propagationMaxLagH * (b - a));
    const ev: any = travelTime(upEv[up.key], downEv[down.key], maxLag);
    const co: any = lagCorrelation(win[up.key].filter(([t]) => t >= corrSince), win[down.key].filter(([t]) => t >= corrSince), maxLag);
    return { from: up.key, from_name: up.name, to: down.key, to_name: down.name, ...combineMethods(ev, co) };
  };
  const pairs: any[] = [], direct: any[] = [];
  for (let i = 0; i + 1 < chain.length; i++) pairs.push(pairOf(i, i + 1));
  for (let i = 0; i < chain.length; i++) for (let j = i + 2; j < chain.length; j++) direct.push(pairOf(i, j));
  const RANK: Record<string, number> = { baja: 0, media: 1, alta: 2 };
  const between = (i: number, j: number): { r: [number, number]; conf: string } | null => {
    const d = direct.find((p) => p.from === chain[i].key && p.to === chain[j].key && p.ok);
    if (d) return { r: d.lag_range_h, conf: d.confidence || "media" };
    let lo = 0, hi = 0, conf = "alta";
    for (let k = i; k < j; k++) {
      const p = pairs[k]; if (!p.ok) return null;
      lo += p.lag_range_h[0]; hi += p.lag_range_h[1];
      if ((RANK[p.confidence] ?? 1) < RANK[conf]) conf = p.confidence;
    }
    return { r: [lo, hi], conf };
  };
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
    // referencia temporal: el pico si ya pasó (último dato por debajo del máximo), si no el último dato ("no antes de")
    const recent = pts.filter(([t]) => t >= onset);
    let pk = recent[0];
    for (const x of recent) if (x[1] >= pk[1]) pk = x;
    const peaked = pk[0] < pts[pts.length - 1][0] && pts[pts.length - 1][1] < pk[1] - 0.02;
    const ref = peaked ? pk[0] : pts[pts.length - 1][0];
    const downstream: any[] = [];
    for (let j = i + 1; j < chain.length; j++) {
      const bj = between(i, j);
      if (!bj) continue;
      const r = bj.r;
      const tgt = chain[j];
      const etaLo = ref + r[0] * H, etaHi = ref + r[1] * H;
      downstream.push({ to: tgt.key, to_name: tgt.name, lag_range_h: r, eta_from: iso(etaLo), eta_to: iso(etaHi), peak_known: peaked,
        hours_from_now: [Math.round(((etaLo - now) / H) * 10) / 10, Math.round(((etaHi - now) / H) * 10) / 10],
        already_rising: trend(win[tgt.key]).label === "SUBIENDO", confidence: bj.conf });
    }
    const msgs = [`Subida en ${s.name} (+${Math.round(riseCm)} cm) que empezó hace unas ${Math.round(hoursAgo)} h${peaked ? `; el pico fue ${fDateShort(pk[0])}` : "; todavía sin pico"}.`];
    for (const d of downstream) {
      const [a, b] = d.hours_from_now;
      const low = d.confidence === "baja" ? " (confianza baja)" : "";
      const what = peaked ? "el pico podría llegar a" : "el pico no llegaría antes de ~";
      if (b < 0) msgs.push(`${d.to_name}: la ventana estimada ya pasó (${Math.round(-b)}–${Math.round(-a)} h atrás)${d.already_rising ? "; está subiendo" : ""}.`);
      else if (peaked) msgs.push(`Estimación${low}: ${what} ${d.to_name} en ~${Math.round(Math.max(a, 0))}–${Math.round(b)} h.`);
      else msgs.push(`Estimación${low}: en ${d.to_name} ${what}${Math.round(Math.max(a, 0))} h (${d.lag_range_h[0] === d.lag_range_h[1] ? d.lag_range_h[0] : `${d.lag_range_h[0]}–${d.lag_range_h[1]}`} h después del pico en ${s.name}).`);
    }
    if (!downstream.length && i < chain.length - 1) msgs.push("No hay suficientes crecidas históricas emparejadas para estimar tiempos aguas abajo.");
    signals.push({ station: s.key, name: s.name, onset: iso(onset), hours_ago: hoursAgo, rise_cm: riseCm, peaked, peak_ts: iso(pk[0]), downstream, messages: msgs });
  });
  return {
    chain: chain.map((s) => ({ key: s.key, name: s.name })),
    excluded: stations.filter((s) => !chain.includes(s)).map((s) => ({ key: s.key, name: s.name, reason: "sin datos" })),
    pairs, direct, signals,
    method: `ESTIMADO. Se detectan las crecidas de cada estación en toda la historia disponible (serie suavizada 24 h; subida ≥ ${CFG.eventUpMinCm} cm aguas arriba y ≥ ${CFG.eventDownMinCm} cm aguas abajo, con bajada posterior). Cada crecida se empareja con la siguiente crecida aguas abajo y se mide la demora entre picos. Se informa la mediana y el rango intercuartil (50 % central de los casos); hacen falta ≥ ${CFG.eventMinMatches} crecidas emparejadas. Además se calcula la correlación cruzada de las variaciones de 24 h (serie suavizada, últimos ${Math.round(CFG.correlationDays / 365)} años). Si los dos métodos coinciden se promedian (confianza alta); si sólo uno alcanza se usa ese (la correlación sola exige r ≥ ${CFG.propagationMinR}); si no coinciden se muestra el rango entre ambos (confianza baja).`,
    disclaimer: "Estimación estadística basada en crecidas pasadas. NO es una predicción hidrológica oficial.",
  };
}

const fDateShort = (ms: number) => { const d = new Date(ms - 3 * H); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00`; };

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
