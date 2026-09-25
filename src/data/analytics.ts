/** Cálculos sobre datos reales. Si falta un dato, el resultado es null con una razón. */

export type P = [number, number]; // [ms UTC, valor]
export const H = 3600e3;
export const D = 86400e3;

export const CFG = {
  trendCmDay: 3,
  staleHours: 24,
  rapidRiseCm6h: 5,
  sustainedRiseCm24h: 5,
  propagationDays: 365,
  propagationMaxLagH: 120,
  rainResponseMinMm: 5,
  suspectJumpM: 1.5,
  levelMin: -5,
  levelMax: 25,
  rainMaxStep: 150,
};

/** Argentina no usa horario de verano desde 2009: UTC−3 fijo. */
export const localDate = (ms: number) => new Date(ms - 3 * H).toISOString().slice(0, 10);
export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

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
  p10: number | null; p25: number | null; p75: number | null; p90: number | null; days_with_data?: number; days_expected?: number; since?: string };

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
  [...g.keys()].sort().forEach((d) => { const a = g.get(d)!; out.set(d, { mean: a.reduce((x, y) => x + y, 0) / a.length, n: a.length, min: Math.min(...a), max: Math.max(...a) }); });
  return out;
}

const CHANGE_WINDOWS: Record<string, [number, number]> = { "1h": [1, 0.6], "6h": [6, 2.1], "12h": [12, 2.1], "24h": [24, 3], "7d": [168, 12], "30d": [720, 24] };

export type Change = { delta_m: number | null; ref_ts?: string; ref_value?: number; reason?: string };
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

export type Trend = { label: string; cm_per_day: number | null; threshold_cm_day?: number; n?: number; reason?: string };
export function trend(pts: P[]): Trend {
  if (!pts.length) return { label: "SIN DATOS", cm_per_day: null };
  const tl = pts[pts.length - 1][0];
  const w = pts.filter(([t]) => t >= tl - 24 * H);
  if (w.length < 3 || w[w.length - 1][0] - w[0][0] < 8 * H) return { label: "INDETERMINADA", cm_per_day: null, reason: "menos de 3 datos en 24 h" };
  const x = w.map(([t]) => (t - w[0][0]) / D), y = w.map(([, v]) => v);
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const slope = den ? (num / den) * 100 : 0;
  const th = CFG.trendCmDay;
  return { label: slope >= th ? "SUBIENDO" : slope <= -th ? "BAJANDO" : "ESTABLE", cm_per_day: Math.round(slope * 100) / 100, threshold_cm_day: th, n: w.length };
}

// ------------------------------------------------------------------ estadísticas
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
  const windows: Record<string, Describe> = {};
  for (const n of [7, 30, 90, 365]) {
    const sel = winDays(n, false);
    windows[`${n}d`] = { ...describe(sel.map((d) => dm.get(d)!.mean)), days_with_data: sel.length, days_expected: n };
  }
  const s7 = winDays(7, true);
  windows["7d_incl_hoy"] = { ...describe(s7.map((d) => dm.get(d)!.mean)), days_with_data: s7.length };
  windows["24h"] = describe(pts.filter(([t]) => t >= ct - 24 * H).map(([, v]) => v));
  windows["historico"] = { ...describe(complete.map((d) => dm.get(d)!.mean)), days_with_data: complete.length, since: iso(pts[0][0]) };
  const month = Number(localDate(ct).slice(5, 7)), year = Number(localDate(ct).slice(0, 4));
  const sm = complete.filter((d) => Number(d.slice(5, 7)) === month && Number(d.slice(0, 4)) < year);
  const clim = { ...describe(sm.map((d) => dm.get(d)!.mean)), years: [...new Set(sm.map((d) => d.slice(0, 4)))].sort(), month };
  const comparisons: Record<string, number | null> = {};
  for (const k of ["7d", "7d_incl_hoy", "30d", "90d", "365d", "historico"]) {
    const m = windows[k].mean;
    comparisons[k] = m == null ? null : Math.round((cv - m) * 1e4) / 1e4;
  }
  comparisons["mismo_mes_hist"] = clim.mean == null ? null : Math.round((cv - clim.mean) * 1e4) / 1e4;
  const hv = complete.map((d) => dm.get(d)!.mean).sort((a, b) => a - b);
  let rank: number | null = null;
  if (hv.length >= 30) { let c = 0; for (const v of hv) if (v <= cv) c++; rank = Math.round((1000 * c) / hv.length) / 10; }
  return {
    available: true, current: { ts: iso(ct), value: cv }, today_mean: dm.get(today)?.mean ?? null, windows,
    same_month_climatology: clim, comparisons, percentile_rank_hist: rank, history_days: complete.length,
    method: "Ventanas ≥7 días: estadísticos de los promedios diarios (días completos en hora argentina). 24 h: datos crudos. Solo datos VALID.",
  };
}

// ------------------------------------------------------------------ crecidas / estado
export function floodDetection(name: string, pts: P[], now = Date.now()) {
  if (!pts.length) return { available: false } as any;
  const ch = changes(pts);
  const [tl, vl] = pts[pts.length - 1];
  const d = (k: string) => ch[k]?.delta_m ?? null;
  const r6 = d("6h"), r12 = d("12h"), r24 = d("24h");
  const out: any = { available: true, messages: [] as string[] };
  out.rise_cm = Object.fromEntries(["1h", "6h", "12h", "24h", "7d", "30d"].map((k) => [k, d(k) == null ? null : Math.round(d(k)! * 1000) / 10]));
  out.rate_cm_h = r6 == null ? null : Math.round((r6 * 100 / 6) * 100) / 100;
  out.rate_cm_day = r24 == null ? null : Math.round(r24 * 1000) / 10;
  out.rapid_rise = r6 != null && r6 * 100 >= CFG.rapidRiseCm6h;
  const last24 = pts.filter(([t]) => t >= tl - 24 * H).map(([, v]) => v);
  const steps = last24.slice(1).map((v, i) => v - last24[i]);
  out.sustained_rise = !!(r24 != null && r24 * 100 >= CFG.sustainedRiseCm24h && steps.length && steps.filter((s) => s >= 0).length / steps.length >= 0.75);
  for (const [k, h] of [["24h", 24], ["7d", 168], ["30d", 720]] as const) {
    const w = pts.filter(([t]) => t >= tl - h * H);
    if (w.length) {
      let mx = w[0], mn = w[0];
      for (const p of w) { if (p[1] >= mx[1]) mx = p; if (p[1] < mn[1]) mn = p; }
      out[`max_${k}`] = { value: mx[1], ts: iso(mx[0]), is_current: mx[0] === tl };
      out[`min_${k}`] = { value: mn[1], ts: iso(mn[0]) };
    }
  }
  const msgs: string[] = out.messages;
  if (r12 != null && r12 >= 0.01 && (out.rapid_rise || out.sustained_rise)) msgs.push(`⚠️ ${name} está subiendo ${Math.round(r12 * 100)} cm en las últimas 12 horas.`);
  else if (r6 != null && out.rapid_rise) msgs.push(`⚠️ ${name} subió ${Math.round(r6 * 100)} cm en las últimas 6 horas.`);
  if (out.max_30d?.is_current && r24 && r24 > 0) msgs.push(`${name} está en el máximo de los últimos 30 días.`);
  else if (out.max_7d?.is_current && r24 && r24 > 0) msgs.push(`${name} está en el máximo de los últimos 7 días.`);
  const today = localDate(now);
  const dm = dailyMeans(pts.filter(([t]) => t >= tl - 31 * D));
  const means = [...dm.entries()].filter(([dd]) => dd < today).map(([, x]) => x.mean).slice(-30);
  if (means.length >= 20) {
    const diff = vl - means.reduce((a, b) => a + b, 0) / means.length;
    out.vs_avg30_cm = Math.round(diff * 1000) / 10;
    if (Math.abs(diff) >= 0.02) msgs.push(`El nivel actual de ${name} está ${Math.round(Math.abs(diff) * 100)} cm ${diff > 0 ? "por encima" : "por debajo"} del promedio de los últimos 30 días.`);
  }
  out.disclaimer = "Detección automática sobre datos de nivel. Superar un promedio no implica emergencia.";
  return out;
}

export function stationStatus(recent: P[], stats: any, manual: number | null | undefined, now = Date.now()) {
  if (!recent.length) return { code: "nodata", emoji: "⚪", label: "SIN DATOS" };
  const age = (now - recent[recent.length - 1][0]) / H;
  const tr = trend(recent);
  const p90 = stats?.available && stats.windows.historico.days_with_data >= 365 ? stats.windows.historico.p90 : null;
  const v = recent[recent.length - 1][1];
  const stale = age > CFG.staleHours;
  const base = { age_hours: Math.round(age * 10) / 10, stale, trend: tr, p90_hist: p90, manual_threshold_m: manual ?? null };
  if ((manual != null && v >= manual) || (p90 != null && v >= p90 && tr.label === "SUBIENDO")) {
    const why = manual != null && v >= manual ? `≥ umbral manual ${manual} m` : `≥ P90 histórico (${p90.toFixed(2)} m) y subiendo`;
    return { ...base, code: "flood", emoji: "🔴", label: "CRECIDA IMPORTANTE", why };
  }
  if (stale) return { ...base, code: "stale", emoji: "⚪", label: "SIN ACTUALIZAR" };
  if (tr.label === "SUBIENDO") return { ...base, code: "rising", emoji: "🔵", label: "SUBIENDO" };
  if (tr.label === "BAJANDO") return { ...base, code: "falling", emoji: "🟠", label: "BAJANDO" };
  if (tr.label === "ESTABLE") return { ...base, code: "stable", emoji: "🟢", label: "ESTABLE" };
  return { ...base, code: "unknown", emoji: "⚪", label: tr.label };
}

// ------------------------------------------------------------------ lluvia
export const RAIN_WINDOWS: Record<string, number> = { "24h": 24, "48h": 48, "72h": 72, "7d": 168, "30d": 720 };

export function rainSummary(pts: P[], lastTs: number | null, now = Date.now()) {
  const out: any = { last_ts: lastTs ? iso(lastTs) : null, windows: {} };
  for (const [k, h] of Object.entries(RAIN_WINDOWS)) {
    const start = now - h * H;
    if (!lastTs || lastTs <= start) out.windows[k] = { mm: null, n: 0, reason: "sin datos en la ventana" };
    else {
      const w = pts.filter(([t]) => t > start).map(([, v]) => v);
      out.windows[k] = { mm: Math.round(w.reduce((a, b) => a + b, 0) * 10) / 10, n: w.length, partial: lastTs < now - CFG.staleHours * H };
    }
  }
  const today = localDate(now);
  const mStart = Date.parse(`${today.slice(0, 8)}01T03:00:00Z`); // 00:00 hora argentina del día 1
  const w = pts.filter(([t]) => t > mStart).map(([, v]) => v);
  out.month_to_date = { mm: w.length ? Math.round(w.reduce((a, b) => a + b, 0) * 10) / 10 : lastTs && lastTs > mStart ? 0 : null, n: w.length };
  out.stale = !lastTs || lastTs < now - CFG.staleHours * H;
  return out;
}

/** El valor acumula el intervalo que termina en t -> se asigna al día de (t − 1 s). */
export function rainDaily(pts: P[], since = 0) {
  const g = new Map<string, number[]>();
  for (const [t, v] of pts) if (t >= since) { const d = localDate(t - 1000); let a = g.get(d); if (!a) g.set(d, (a = [])); a.push(v); }
  return [...g.keys()].sort().map((d) => ({ date: d, mm: Math.round(g.get(d)!.reduce((a, b) => a + b, 0) * 10) / 10, n: g.get(d)!.length }));
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

export function lagCorrelation(up: P[], down: P[], maxLag: number, diffH = 6) {
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
  let lo = best, hi = best;
  while (lo - 1 >= 0 && !Number.isNaN(res[lo - 1].r) && res[lo - 1].r >= rmax - 0.03) lo--;
  while (hi + 1 < res.length && !Number.isNaN(res[hi + 1].r) && res[hi + 1].r >= rmax - 0.03) hi++;
  return { ok: true, lag_h: best, lag_range_h: [lo, hi] as [number, number], r: Math.round(rmax * 1000) / 1000,
    confidence: rmax >= 0.6 ? "alta" : rmax >= 0.4 ? "media" : "baja", n_pairs: res[best].n,
    curve: res.map((x) => ({ lag_h: x.lag, r: Number.isNaN(x.r) ? null : Math.round(x.r * 1000) / 1000 })) };
}

export function riseOnset(pts: P[]): number | null {
  if (pts.length < 3) return null;
  const tl = pts[pts.length - 1][0];
  const w = pts.filter(([t]) => t >= tl - 72 * H);
  if (w.length < 3) return null;
  const vmin = Math.min(...w.map(([, v]) => v));
  const tmin = Math.max(...w.filter(([, v]) => v === vmin).map(([t]) => t));
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
    const fd = floodDetection(s.name, pts, now);
    const tr = trend(pts);
    if (!(fd.rapid_rise || fd.sustained_rise || tr.label === "SUBIENDO")) return;
    const onset = riseOnset(pts);
    if (onset == null) return;
    const minAfter = Math.min(...pts.filter(([t]) => t >= onset).map(([, v]) => v));
    const riseCm = Math.round((pts[pts.length - 1][1] - minAfter) * 1000) / 10;
    const hoursAgo = Math.round(((now - onset) / H) * 10) / 10;
    const downstream: any[] = [];
    let loAcc = 0, hiAcc = 0, broken = false;
    for (let j = i; j < chain.length - 1; j++) {
      const p = pairs[j];
      if (!p.ok || p.r < 0.3) { broken = true; break; }
      loAcc += p.lag_range_h[0]; hiAcc += p.lag_range_h[1];
      const tgt = chain[j + 1];
      const etaLo = onset + loAcc * H, etaHi = onset + hiAcc * H;
      downstream.push({ to: tgt.key, to_name: tgt.name, lag_range_h: [loAcc, hiAcc], eta_from: iso(etaLo), eta_to: iso(etaHi),
        hours_from_now: [Math.round(((etaLo - now) / H) * 10) / 10, Math.round(((etaHi - now) / H) * 10) / 10],
        already_rising: trend(win[tgt.key]).label === "SUBIENDO" });
    }
    const msgs = [`Se detectó una señal de subida en ${s.name} (+${Math.round(riseCm)} cm) que comenzó hace aproximadamente ${Math.round(hoursAgo)} h.`];
    for (const d of downstream) {
      const [a, b] = d.hours_from_now;
      if (d.already_rising) msgs.push(`En ${d.to_name} ya se observa subida.`);
      else if (b < 0) msgs.push(`La ventana estimada para ${d.to_name} ya pasó (${Math.round(-b)}–${Math.round(-a)} h atrás) sin subida clara.`);
      else msgs.push(`Si el patrón continúa, podría comenzar a observarse en ${d.to_name} dentro de aproximadamente ${Math.round(Math.max(a, 0))}–${Math.round(b)} h.`);
    }
    if (broken && !downstream.length) msgs.push("No hay correlación suficiente con la estación siguiente para estimar tiempos.");
    signals.push({ station: s.key, name: s.name, onset: iso(onset), hours_ago: hoursAgo, rise_cm: riseCm, downstream, messages: msgs });
  });
  return {
    chain: chain.map((s) => ({ key: s.key, name: s.name })),
    excluded: stations.filter((s) => !chain.includes(s)).map((s) => ({ key: s.key, name: s.name, reason: "sin datos en las últimas 72 h" })),
    pairs, signals,
    method: `Correlación cruzada entre variaciones de 6 h del nivel (series interpoladas a grilla horaria, huecos >12 h excluidos), últimos ${CFG.propagationDays} días, desfases 0–${CFG.propagationMaxLagH} h. El rango X–Y h son los desfases con correlación a ≤0,03 del máximo. La resolución real es la de la serie (1–4 h).`,
    disclaimer: "Estimación estadística basada en el comportamiento pasado de las series. NO es una predicción hidrológica oficial.",
  };
}
