import { Station } from "../api";
import { ago, cm, dev, fDateTime, num, signed, STATION_COLOR, stationColor } from "../fmt";

export function StatusBadge({ s }: { s?: Station["status"] }) {
  if (!s) return <span className="badge b-nodata">SIN DATOS</span>;
  return <span className={`badge b-${s.code}`} title={s.why || ""}>{s.label}</span>;
}

export const STATUS_VAR: Record<string, string> = { stable: "var(--ok)", rising: "var(--rise)", falling: "var(--fall)", flood: "var(--flood)" };

const Delta = ({ m }: { m: number | null | undefined }) =>
  m === null || m === undefined ? <b className="muted">—</b> : <b className={m > 0 ? "up" : m < 0 ? "down" : ""}>{cm(m)}</b>;

/** Minigráfico de 7 días (línea fina + área suave, sin ejes). */
export function Sparkline({ pts, color }: { pts?: [number, number][]; color: string }) {
  if (!pts || pts.length < 2) return <div className="spark nodata small" style={{ display: "grid", placeItems: "center" }}>sin datos 7 d</div>;
  const W = 200, Hh = 44, pad = 3;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
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

/** Dónde está hoy respecto de su propia historia: barra 0–100 con banda normal (P25–P75). */
export function PctBar({ s }: { s: Station }) {
  const b = s.stats_brief;
  if (!b || b.pct == null || !b.pct_class) return <div className="pct nodata small">Historia insuficiente para comparar</div>;
  const c = PCT_VAR[b.pct_class.code];
  return (
    <div className="pct" title={`Mediana histórica ${num(b.hist?.median)} m · normal (P25–P75): ${num(b.hist?.p25)}–${num(b.hist?.p75)} m · ${b.history_days} días de historia${b.base_from ? " (desde un probable cambio de escala)" : ""}`}>
      <div className="pct-top"><span>Percentil <b>{Math.round(b.pct)}</b></span><b style={{ color: c }}>{b.pct_class.label.toUpperCase()}</b></div>
      <div className="pct-track">
        <i className="band" style={{ left: "25%", width: "50%" }} />
        <i className="mark" style={{ left: `${Math.min(100, Math.max(0, b.pct))}%`, background: c }} />
      </div>
      <div className="pct-sub">rango normal de escala: {num(b.hist?.p25)}–{num(b.hist?.p75)} m · {Math.round(b.history_days / 365 * 10) / 10 >= 1 ? `${(Math.round(b.history_days / 36.5) / 10).toLocaleString("es-AR")} años` : `${b.history_days} días`} de historia</div>
    </div>
  );
}

export function StationCard({ s }: { s: Station }) {
  const lv = s.level;
  const ch = lv?.changes || {};
  const tr = s.status?.trend;
  const color = stationColor(s.key);
  return (
    <div className="st-card" style={{ ["--status" as any]: STATUS_VAR[s.status?.code || ""] || "var(--stale)" }}>
      <div className="head">
        <h3><span className="swatch" style={{ background: color }} />{s.name}</h3>
        <StatusBadge s={s.status} />
      </div>
      {lv ? (
        <>
          {(() => {
            const med = s.stats_brief?.hist?.median;
            const d = med == null ? null : lv.value - med;
            const cls = s.stats_brief?.pct_class;
            return <>
              <div className="big" style={{ color: cls ? PCT_VAR[cls.code] : undefined }}>
                {d == null ? <>{num(lv.value)}<small>m</small></> : dev(d)}
                {tr?.cm_per_day != null && <span className={`rate ${tr.cm_per_day > 0 ? "up" : tr.cm_per_day < 0 ? "down" : "muted"}`}>{signed(tr.cm_per_day, " cm/d")}</span>}
              </div>
              <div className="caption">
                {d == null ? "Lectura de escala (sin historia para comparar)" : <>respecto de lo normal <span title="Mediana de todos los días registrados en esta estación">(mediana {num(med)} m)</span></>}
              </div>
              <div className="scale" title="Es la lectura de la regla/sensor de esta estación. Su cero es arbitrario: NO es la profundidad del río y no se compara entre estaciones.">
                Lectura de escala: <b>{num(lv.value)} m</b> <span className="muted">· no es profundidad ⓘ</span>
              </div>
            </>;
          })()}
          <PctBar s={s} />
          <Sparkline pts={s.spark} color={color} />
          <div className="deltas">
            <div><span>6 h</span><Delta m={ch["6h"]?.delta_m} /></div>
            <div><span>24 h</span><Delta m={ch["24h"]?.delta_m} /></div>
            <div><span>7 días</span><Delta m={ch["7d"]?.delta_m} /></div>
          </div>
          <div className="foot">
            <span title={fDateTime(lv.ts)}>{fDateTime(lv.ts).slice(0, 5)} {fDateTime(lv.ts).slice(-5)} · {ago(lv.ts)}</span>
            <a href={s.source.url} target="_blank" rel="noreferrer">INA ↗</a>
          </div>
          {s.status?.stale && <div className="stale-note">Sin datos nuevos hace más de 24 h</div>}
        </>
      ) : (
        <div className="nodata" style={{ marginTop: 12 }}>Sin datos de nivel.</div>
      )}
    </div>
  );
}

export function StationTable({ stations }: { stations: Station[] }) {
  return (
    <div className="card tablewrap">
      <table>
        <thead>
          <tr>
            <th>Estación</th><th>Tipo</th><th className="n">vs normal</th><th className="n">Percentil</th><th className="n">Escala (m)</th><th className="n">Caudal</th><th className="n">1 h</th><th className="n">6 h</th>
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
              <td className="n"><b>{s.level && s.stats_brief?.hist?.median != null ? dev(s.level.value - s.stats_brief.hist.median) : "—"}</b></td>
              <td className="n">{s.stats_brief?.pct != null ? `P${Math.round(s.stats_brief.pct)} · ${s.stats_brief.pct_class?.label}` : "—"}</td>
              <td className="n muted">{s.level ? num(s.level.value) : "—"}</td>
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
