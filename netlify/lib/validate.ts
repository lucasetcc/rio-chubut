/** Validaciones puras compartidas por las functions (testeadas en tests/functions.test.ts). */

/** El "bucket" define la vigencia del caché. Sólo se acepta el actual ±1, para que nadie
 *  pueda saltear el caché inventando valores y golpear al INA. */
export function okBucket(x: string | undefined, sizeMs: number, now = Date.now()): boolean {
  if (!x || !/^\d{1,12}$/.test(x)) return false;
  const n = Number(x), cur = Math.floor(now / sizeMs);
  return Math.abs(n - cur) <= 1;
}

export function safeUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u || u.length > 500) return null;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
}

const str = (v: unknown, max = 300) => typeof v === "string" && v.length <= max;
const numOk = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const RULE_TYPES = ["rise", "above_avg", "trend", "propagation", "rain", "stale"];
const DAM_VARS = ["cota", "volumen", "almacenamiento_pct", "caudal_entrante", "caudal_saliente", "generacion"];
const ROLES = ["level", "rain", "level_hist", "level_ext", "discharge"];

/** Valida y normaliza la configuración compartida. Devuelve { ok, value } o { ok:false, error }. */
export function validateSettings(body: any): { ok: true; value: any } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "formato inválido" };
  const out: any = {};
  if (body.rules !== undefined) {
    if (!Array.isArray(body.rules) || body.rules.length > 50) return { ok: false, error: "rules inválido" };
    out.rules = [];
    for (const r of body.rules) {
      if (!r || !RULE_TYPES.includes(r.type) || !numOk(r.id)) return { ok: false, error: "regla inválida" };
      if (r.station_key != null && !(str(r.station_key, 40) && /^[a-z0-9_]+$/.test(r.station_key))) return { ok: false, error: "estación inválida" };
      const params: any = {};
      for (const [k, v] of Object.entries(r.params || {})) {
        if (!["cm", "hours", "days", "mm", "direction"].includes(k)) continue;
        if (k === "direction") { if (v !== "SUBIENDO" && v !== "BAJANDO") return { ok: false, error: "dirección inválida" }; params[k] = v; }
        else { if (!numOk(v) || (v as number) < 0 || (v as number) > 10000) return { ok: false, error: `parámetro ${k} inválido` }; params[k] = v; }
      }
      if (r.description != null && !str(r.description, 200)) return { ok: false, error: "descripción demasiado larga" };
      out.rules.push({ id: r.id, type: r.type, station_key: r.station_key ?? null, params, enabled: r.enabled ? 1 : 0, description: r.description ?? "" });
    }
  }
  if (body.thresholds !== undefined) {
    if (!body.thresholds || typeof body.thresholds !== "object" || Array.isArray(body.thresholds)) return { ok: false, error: "thresholds inválido" };
    out.thresholds = {};
    for (const [k, t] of Object.entries<any>(body.thresholds)) {
      if (!/^[a-z0-9_]{1,40}$/.test(k) || !t || !numOk(t.crecida_m) || !str(t.source, 200) || !t.source.trim() || !safeUrl(t.url))
        return { ok: false, error: `umbral de ${k} inválido (requiere valor, fuente y URL http/https)` };
      out.thresholds[k] = { crecida_m: t.crecida_m, source: t.source.trim(), url: safeUrl(t.url) };
    }
  }
  if (body.dam !== undefined) {
    if (!Array.isArray(body.dam) || body.dam.length > 1000) return { ok: false, error: "dam inválido" };
    out.dam = [];
    for (const r of body.dam) {
      if (!r || !DAM_VARS.includes(r.variable) || !numOk(r.value) || !str(r.source, 200) || !str(r.ts, 40) || Number.isNaN(Date.parse(r.ts)))
        return { ok: false, error: "dato del dique inválido" };
      if (r.source_url && !safeUrl(r.source_url)) return { ok: false, error: "URL del dique inválida (sólo http/https)" };
      out.dam.push({ id: numOk(r.id) ? r.id : Date.now(), ts: r.ts, variable: r.variable, value: r.value, unit: str(r.unit, 10) ? r.unit : "",
        source: r.source, source_url: r.source_url ? safeUrl(r.source_url) : null, note: str(r.note, 300) ? r.note : null, quality: "MANUAL",
        entered_at: str(r.entered_at, 40) ? r.entered_at : new Date().toISOString() });
    }
  }
  if (body.dam_limits !== undefined) {
    const l = body.dam_limits || {};
    for (const k of ["cota_max_normal", "cota_min_operativa"]) if (l[k] != null && !numOk(l[k])) return { ok: false, error: "dam_limits inválido" };
    out.dam_limits = { cota_max_normal: l.cota_max_normal ?? null, cota_min_operativa: l.cota_min_operativa ?? null };
  }
  if (body.extra_series !== undefined) {
    if (!Array.isArray(body.extra_series) || body.extra_series.length > 100) return { ok: false, error: "extra_series inválido" };
    out.extra_series = [];
    for (const x of body.extra_series) {
      if (!x || !numOk(x.series_id) || !numOk(x.ina_station_id) || !ROLES.includes(x.role) || !/^[a-z0-9_]{1,40}$/.test(String(x.station_key)))
        return { ok: false, error: "serie agregada inválida" };
      out.extra_series.push({ series_id: x.series_id, ina_station_id: x.ina_station_id, role: x.role, var_id: numOk(x.var_id) ? x.var_id : null,
        station_key: x.station_key, name: String(x.name ?? "").replace(/[<>&"'`]/g, "").slice(0, 80),
        lat: numOk(x.lat) ? x.lat : null, lon: numOk(x.lon) ? x.lon : null });
    }
  }
  if (body.ignored_series !== undefined) {
    if (!Array.isArray(body.ignored_series) || body.ignored_series.length > 1000 || !body.ignored_series.every(numOk)) return { ok: false, error: "ignored_series inválido" };
    out.ignored_series = body.ignored_series;
  }
  if (body.discovery !== undefined) {
    const d = body.discovery;
    if (!d || !Array.isArray(d.candidates) || d.candidates.length > 500) return { ok: false, error: "discovery inválido" };
    out.discovery = { last_run: str(d.last_run, 40) ? d.last_run : null,
      candidates: d.candidates.filter((c: any) => c && numOk(c.series_id) && numOk(c.ina_station_id)).map((c: any) => ({
        series_id: c.series_id, ina_station_id: c.ina_station_id, station_name: String(c.station_name ?? "").replace(/[<>&"'`]/g, "").slice(0, 80),
        lat: numOk(c.lat) ? c.lat : null, lon: numOk(c.lon) ? c.lon : null, var_id: numOk(c.var_id) ? c.var_id : null,
        var_code: String(c.var_code ?? "").slice(0, 10), var_name: String(c.var_name ?? "").replace(/[<>&"'`]/g, "").slice(0, 80),
        unit: String(c.unit ?? "").slice(0, 10), timestart: String(c.timestart ?? "").slice(0, 40), timeend: String(c.timeend ?? "").slice(0, 40),
        count: numOk(Number(c.count)) ? Number(c.count) : null, availability: String(c.availability ?? "").slice(0, 10) })) };
  }
  return { ok: true, value: out };
}
