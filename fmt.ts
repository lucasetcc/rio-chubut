export const TZ = "America/Argentina/Buenos_Aires";

const dtf = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const df = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const tf = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

export const fDateTime = (iso?: string | null) => (iso ? dtf.format(new Date(iso)).replace(",", "") : "—");
export const fDate = (iso?: string | null) => (iso ? df.format(new Date(iso)) : "—");
export const fTime = (iso?: string | null) => (iso ? tf.format(new Date(iso)) : "—");

export const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : v.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** metros -> "+12 cm" */
export const cm = (m: number | null | undefined, d = 0) => {
  if (m === null || m === undefined) return "—";
  const v = Number((m * 100).toFixed(d)); // evita "−0 cm"
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: d })} cm`;
};

export const signed = (v0: number | null | undefined, unit = "", d = 1) => {
  if (v0 === null || v0 === undefined) return "—";
  const v = Number(v0.toFixed(d));
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: d })}${unit}`;
};

export function ago(iso?: string | null): string {
  if (!iso) return "sin datos";
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export const isoDaysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

/** Colores fijos por estación (color sigue a la entidad, nunca al orden). */
export const STATION_COLOR: Record<string, string> = {
  gualjaina: "var(--s1)", paso_del_sapo: "var(--s2)", cerro_condor: "var(--s3)", los_altares: "var(--s4)",
  las_plumas: "var(--s5)", el_maiten: "var(--s6)", tecka: "var(--s7)", alto_chubut: "var(--s8)", norquinco: "#c9a227", gualjaina_rio: "#3fb6c9", chico_ameghino: "#a0703a", ameghino_abajo: "var(--muted)",
};

export function cssVar(v: string): string {
  if (!v.startsWith("var(")) return v;
  const name = v.slice(4, -1);
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export const stationColor = (key: string) => cssVar(STATION_COLOR[key] || "var(--s1)");

/** Desvío en metros -> "+45 cm" o "+1,62 m". */
export const dev = (m: number | null | undefined) => {
  if (m === null || m === undefined) return "—";
  const a = Math.abs(m), sg = m > 0.005 ? "+" : m < -0.005 ? "−" : "±";
  return a >= 1 ? `${sg}${a.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m` : `${sg}${Math.round(a * 100)} cm`;
};

/** Sólo URLs http/https (evita javascript: y similares). */
export const safeUrl = (u?: string | null): string | null => {
  if (!u) return null;
  try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
};

/** Escapa texto para tooltips HTML (ECharts arma HTML con strings). */
export const esc = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Fecha y hora con "ART" explícito. */
export const fDateTimeArt = (iso?: string | null) => (iso ? `${fDateTime(iso)} ART` : "—");
