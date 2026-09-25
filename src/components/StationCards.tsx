import { Station } from "../api";
import { ago, cm, fDateTime, num, signed, STATION_COLOR } from "../fmt";

export function StatusBadge({ s }: { s?: Station["status"] }) {
  if (!s) return <span className="badge b-nodata">⚪ SIN DATOS</span>;
  return <span className={`badge b-${s.code}`} title={s.why || ""}>{s.emoji} {s.label}</span>;
}

const Delta = ({ m }: { m: number | null | undefined }) =>
  m === null || m === undefined ? <span className="muted">—</span> : <span className={m > 0 ? "up" : m < 0 ? "down" : ""}>{cm(m)}</span>;

export function StationCard({ s }: { s: Station }) {
  const lv = s.level;
  const ch = lv?.changes || {};
  const tr = s.status?.trend;
  return (
    <div className="st-card">
      <h3>
        <span className="swatch" style={{ background: STATION_COLOR[s.key] }} />
        {s.name}
      </h3>
      <div className="row" style={{ marginTop: 6 }}>
        <StatusBadge s={s.status} />
        {tr?.cm_per_day != null && <span className="small muted">{signed(tr.cm_per_day, " cm/día")}</span>}
      </div>
      {lv ? (
        <>
          <div className="big">{num(lv.value)} <small>m</small></div>
          <div className="small muted">Nivel hidrométrico (escala local, medido)</div>
          <dl className="kv">
            <dt>Caudal</dt><dd className="nodata" title={s.discharge_note || ""}>sin datos públicos</dd>
            <dt>1 h</dt><dd>{ch["1h"]?.delta_m == null ? <span className="muted" title={ch["1h"]?.reason}>n/d</span> : <Delta m={ch["1h"].delta_m} />}</dd>
            <dt>6 h</dt><dd><Delta m={ch["6h"]?.delta_m} /></dd>
            <dt>24 h</dt><dd><Delta m={ch["24h"]?.delta_m} /></dd>
            <dt>7 días</dt><dd><Delta m={ch["7d"]?.delta_m} /></dd>
            <dt>30 días</dt><dd><Delta m={ch["30d"]?.delta_m} /></dd>
            <dt>vs prom. 30 d</dt><dd><Delta m={s.stats_brief?.comparisons?.["30d"]} /></dd>
          </dl>
          <div className="small" style={{ marginTop: 8 }}>
            Último dato: <b>{fDateTime(lv.ts)}</b> <span className="muted">({ago(lv.ts)})</span>
          </div>
          {s.status?.stale && <div className="stale-note">⚠ Estación sin actualizar</div>}
        </>
      ) : (
        <div className="nodata" style={{ marginTop: 10 }}>Sin datos de nivel almacenados todavía.</div>
      )}
      <div className="src" style={{ marginTop: 6 }}>
        Fuente: INA · serie {s.series.find((x) => x.role === "level")?.id} · <a href={s.source.url} target="_blank" rel="noreferrer">Ver fuente original ↗</a>
      </div>
    </div>
  );
}

export function StationTable({ stations }: { stations: Station[] }) {
  return (
    <div className="card tablewrap">
      <table>
        <thead>
          <tr>
            <th>Estación</th><th>Tipo</th><th className="n">Nivel (m)</th><th className="n">Caudal</th><th className="n">1 h</th><th className="n">6 h</th>
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
              <td className="n">{s.level ? num(s.level.value) : "—"}</td>
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
