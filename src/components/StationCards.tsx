import { Station } from "../api";
import { ago, cm, dev, fDateTime, fDateTimeArt, num, signed, STATION_COLOR, stationColor } from "../fmt";

export function StatusBadge({ s }: { s?: Station["status"] }) {
  if (!s) return <span className="badge b-nodata">SIN DATOS</span>;
  return <span className={`badge b-${s.code}`} title={s.why || ""}>{s.label}</span>;
}

export const STATUS_VAR: Record<string, string> = { stable: "var(--ok)", rising: "var(--rise)", falling: "var(--neutral)", over: "var(--flood)" };

const Delta = ({ m }: { m: number | null | undefined }) =>
  m === null || m === undefined ? <b className="muted">—</b> : <b className={m > 0 ? "up" : m < 0 ? "down" : ""}>{cm(m)}</b>;

/** Minigráfico de 7 días (línea fina + área suave, sin ejes). */
export function Sparkline({ pts, color }: { pts?: [number, number][]; color: string }) {
  if (!pts || pts.length < 2) return <div className="spark nodata small" style={{ display: "grid", placeItems: "center" }}>sin datos 7 d</div>;
  const W = 200, Hh = 44, pad = 3;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  if (hi - lo < 0.05) { const m = (hi + lo) / 2; lo = m - 0.025; hi = m + 0.025; }
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (Hh - 2 * pad);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" aria-label="últimos 7 días">
      <path d={`${d}L${W},${Hh}L0,${Hh}Z`} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r={2.8} fill={color} />
    </svg>
  );
}

export const PCT_VAR: Record<string, string> = { vlow: "var(--fall)", low: "#d9a441", normal: "var(--ok)", high: "var(--rise)", vhigh: "var(--flood)" };

export const Tag = ({ k }: { k: "med" | "calc" | "est" | "pub" }) => {
  const L = { med: "MEDIDO · INA", calc: "CALCULADO", est: "ESTIMADO", pub: "PUBLICADO EN PRENSA" };
  return <span className={`tag tag-${k}`}>{L[k]}</span>;
};

/** Comparación con lo normal. Sólo hay percentil/clase si existe climatología del mismo mes (≥3 años). */
export function PctBar({ s }: { s: Station }) {
  const b = s.stats_brief;
  const lv = s.level;
  if (!b || !lv) return null;
  const clim = b.clim;
  if (!clim?.ok || b.pct == null) {
    const d = b.record_median != null ? lv.value - b.record_median : null;
    return (
      <div className="pct small">
        <div className="pct-top"><span>vs mediana del registro <span className="muted">(desde {fDateTime(b.record_since).slice(3, 10)})</span></span><b>{dev(d)}</b></div>
        <div className="pct-sub">Sin clase: {clim?.reason || "registro corto"}. <Tag k="calc" /></div>
      </div>
    );
  }
  const c = b.pct_class ? PCT_VAR[b.pct_class.code] : "var(--muted)";
  const span = `${clim.month_name} ${clim.years[0]}–${clim.years[clim.years.length - 1]}`;
  const d = clim.median != null ? lv.value - clim.median : null;
  return (
    <div className="pct" title={`Mediana de ${clim.month_name} (${clim.years.join(", ")}): ${num(clim.median)} m · rango normal (P25–P75): ${num(clim.p25)}–${num(clim.p75)} m`}>
      <div className="pct-top"><span>vs {b.pct_class ? `${clim.month_name} de años anteriores` : span}: <b>{dev(d)}</b></span>{b.pct_class && <b style={{ color: c }}>{b.pct_class.label.toUpperCase()}</b>}</div>
      <div className="pct-track">
        <i className="band" style={{ left: "25%", width: "50%" }} />
        <i className="mark" style={{ left: `${Math.min(100, Math.max(0, b.pct))}%`, background: c }} />
      </div>
      <div className="pct-sub">Percentil {Math.round(b.pct)} · {clim.years[0]}–{clim.years[clim.years.length - 1]} ({clim.years.length} años{b.pct_class ? "" : "; sin adjetivo hasta tener ≥5 años"}) <Tag k="calc" /></div>
    </div>
  );
}

function SourceState({ s }: { s: Station }) {
  if (s.source_state === "mismatch") return <div className="state err">Serie inconsistente en la fuente (el INA cambió la estación o variable). No se muestran datos.</div>;
  if (s.source_state === "error") return <div className="state err">Error al consultar el INA{s.source_error_at ? ` (${fDateTime(s.source_error_at).slice(-5)} ART)` : ""}. Se reintenta solo.</div>;
  return <div className="state nodata">Sin datos de nivel en los últimos 45 días.</div>;
}

export function StationCard({ s }: { s: Station }) {
  const lv = s.level;
  const ch = lv?.changes || {};
  const tr = s.status?.trend;
  const stale = s.status?.code === "stale";
  const color = stationColor(s.key);
  return (
    <div className={`st-card ${stale ? "is-stale" : ""}`} style={{ ["--status" as any]: STATUS_VAR[s.status?.code || ""] || "var(--stale)" }}>
      <div className="head">
        <h3><span className="swatch" style={{ background: color }} />{s.name}</h3>
        <StatusBadge s={s.status} />
      </div>
      {!s.main && s.river && <div className="small muted" style={{ marginTop: -4, marginBottom: 6 }}>{s.river}</div>}
      {lv && s.source_state !== "mismatch" ? (
        <>
          <div className="big">{num(lv.value)}<small>m</small>
            {!stale && tr?.cm_per_day != null && <span className={`rate ${tr.label === "SUBIENDO" ? "up" : "muted"}`} title="Pendiente de las últimas 24 h (CALCULADO)">{signed(tr.cm_per_day, " cm/d")}</span>}
          </div>
          <div className="caption">Lectura de escala · no es profundidad <Tag k="med" /></div>
          <div className="when">{stale ? "Último dato" : "Dato"}: <b>{fDateTimeArt(lv.ts)}</b> · {ago(lv.ts)}</div>
          {s.source_state === "partial_error" && <div className="state err small">La última consulta al INA falló; se muestra el último dato obtenido.</div>}
          <PctBar s={s} />
          {!stale && <Sparkline pts={s.spark} color={color} />}
          <div className="deltas" title="Cambios respecto del último dato">
            <div><span>6 h</span><Delta m={ch["6h"]?.delta_m} /></div>
            <div><span>24 h</span><Delta m={ch["24h"]?.delta_m} /></div>
            <div><span>7 días</span><Delta m={ch["7d"]?.delta_m} /></div>
          </div>
          <div className="foot">
            <span>Umbral oficial: {s.status?.manual_threshold_m != null ? `${num(s.status.manual_threshold_m)} m (cargado)` : "no disponible"}</span>
            <a href={s.source.url} target="_blank" rel="noreferrer">INA ↗</a>
          </div>
        </>
      ) : <SourceState s={s} />}
    </div>
  );
}

export function StationTable({ stations }: { stations: Station[] }) {
  return (
    <div className="card tablewrap">
      <table>
        <thead>
          <tr>
            <th>Estación</th><th>Tipo</th><th className="n">Escala (m)</th><th className="n">vs mismo mes</th><th className="n">Clase</th><th className="n">Caudal</th><th className="n">1 h</th><th className="n">6 h</th>
            <th className="n">24 h</th><th>Tendencia</th><th className="n">Lluvia 24 h</th><th>Último dato</th><th>Fuente</th>
          </tr>
        </thead>
        <tbody>
          {stations.map((s) => (
            <tr key={s.key}>
              <td>
                <span className="swatch" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, background: STATION_COLOR[s.key] || "transparent" }} />
                <b>{s.name}</b>
                <div className="small muted">{s.river}{s.notes ? ` · ${s.notes}` : ""}</div>
              </td>
              <td className="small">{s.kind === "rain" ? "Meteorológica" : s.kind === "dam_outflow" ? "Río bajo el dique" : s.chain_order ? "Río Chubut" : "Afluente"}</td>
              <td className="n"><b>{s.level ? num(s.level.value) : "—"}</b></td>
              <td className="n">{s.level && s.stats_brief?.clim?.ok && s.stats_brief.clim.median != null ? dev(s.level.value - s.stats_brief.clim.median) : "—"}</td>
              <td className="n">{s.stats_brief?.pct != null ? `P${Math.round(s.stats_brief.pct)}${s.stats_brief.pct_class ? ` · ${s.stats_brief.pct_class.label}` : ""}` : <span className="muted">sin clase</span>}</td>
              <td className="n nodata">{s.has_level ? "s/d" : "—"}</td>
              <td className="n">{s.level ? (s.level.changes["1h"]?.delta_m == null ? "n/d" : cm(s.level.changes["1h"].delta_m)) : "—"}</td>
              <td className="n">{s.level ? cm(s.level.changes["6h"]?.delta_m) : "—"}</td>
              <td className="n">{s.level ? cm(s.level.changes["24h"]?.delta_m) : "—"}</td>
              <td>{s.has_level ? <StatusBadge s={s.status} /> : <span className="muted">—</span>}</td>
              <td className="n">{s.rain ? (s.rain.windows["24h"].mm == null ? <span className="nodata">sin datos</span> : `${num(s.rain.windows["24h"].mm, 1)} mm`) : "—"}</td>
              <td className="small">
                {s.level ? <>{fDateTime(s.level.ts)}<div className="muted">{ago(s.level.ts)}</div></>
                  : s.rain?.last_ts ? <>{fDateTime(s.rain.last_ts)}<div className="muted">{ago(s.rain.last_ts)}</div></> : <span className="nodata">sin datos</span>}
              </td>
              <td className="small"><a href={s.source.url} target="_blank" rel="noreferrer">INA ↗</a></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="src" style={{ marginTop: 8 }}>
        "n/d" en 1 h: la mayoría de las series del INA se publican cada 4 h, así que no hay un dato de hace 1 h para comparar. Caudal "s/d": el INA no publica caudal para estas estaciones.
      </div>
    </div>
  );
}
