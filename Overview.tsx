import { Station } from "../api";
import { ago, cm, cssVar, dev, fDateTime, num, stationColor } from "../fmt";
import { PCT_VAR, STATUS_VAR } from "./StationCards";

const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

export function Headline({ main, prop, fcTop }: { main: Station[]; prop: any; fcTop?: { name: string; mm: number } | null }) {
  const withData = main.filter((s) => s.level && s.status?.code !== "stale");
  const staleSt = main.filter((s) => s.status?.code === "stale");
  const flood = withData.filter((s) => s.status?.code === "over");
  const rising = withData.filter((s) => s.status?.code === "rising");
  const falling = withData.filter((s) => s.status?.code === "falling");
  const top = [...withData].sort((a, b) => (b.level!.changes["24h"]?.delta_m ?? -9) - (a.level!.changes["24h"]?.delta_m ?? -9))[0];
  const parts: JSX.Element[] = [];
  if (flood.length) parts.push(<span key="f"><b style={{ color: "var(--flood)" }}>Sobre el umbral cargado</b> en {join(flood.map((s) => s.name))}. </span>);
  if (rising.length) parts.push(<span key="r">Nivel <b>en ascenso</b> en {join(rising.map((s) => s.name))}. </span>);
  else if (!flood.length) parts.push(<span key="s">{falling.length ? <>Nivel en descenso en {join(falling.map((s) => s.name))}; resto estable. </> : <>Niveles <b>estables</b> en la cuenca. </>}</span>);
  if (top?.level?.changes["24h"]?.delta_m && top.level.changes["24h"].delta_m > 0.02)
    parts.push(<span key="t">Mayor subida en 24 h: <b>{top.name} ({cm(top.level.changes["24h"].delta_m)})</b>. </span>);
  const sig = prop?.signals?.[0];
  const next = sig?.downstream?.find((d: any) => !d.already_rising && d.hours_from_now[1] >= 0);
  if (next) parts.push(next.peak_known
    ? <span key="p">Estimación estadística: el pico de {sig.name} podría llegar a <b>{next.to_name}</b> en ~{Math.round(Math.max(next.hours_from_now[0], 0))}–{Math.round(next.hours_from_now[1])} h. </span>
    : <span key="p">{sig.name} sigue subiendo; estimación estadística: el pico no llegaría a <b>{next.to_name}</b> antes de ~{Math.round(Math.max(next.hours_from_now[0], 0))} h. </span>);
  if (staleSt.length) parts.push(<span key="st" className="muted">Sin datos recientes: {join(staleSt.map((s) => s.name))}. </span>);
  if (fcTop && fcTop.mm != null && fcTop.mm >= 5) parts.push(<span key="fc">Pronóstico de modelos: hasta <b>{num(fcTop.mm, 0)} mm en {fcTop.name}</b> (hoy + 2 días).</span>);
  return <div className="headline">{parts}</div>;
}

export function Kpis({ status, main, rain, alerts }: { status: any; main: Station[]; rain: any; alerts: any[] }) {
  const lvl = (status?.series || []).filter((s: any) => s.role === "level");
  const fresh = lvl.filter((s: any) => !s.stale).length;
  const rising = main.filter((s) => s.status?.code === "rising" || s.status?.code === "over");
  const rs = (rain?.stations || []).filter((r: any) => r.windows["24h"].mm != null);
  const maxR = rs.sort((a: any, b: any) => b.windows["24h"].mm - a.windows["24h"].mm)[0];
  const max72 = [...rs].sort((a: any, b: any) => (b.windows["72h"].mm ?? 0) - (a.windows["72h"].mm ?? 0))[0];
  const act = alerts.filter((a) => !a.cleared_at);
  return (
    <div className="kpis">
      <div className="kpi"><div className="k">Estaciones al día</div><div className="v">{fresh}<small> / {lvl.length}</small></div>
        <div className="d">Último dato {status?.last_data_ts ? ago(status.last_data_ts) : "—"}</div></div>
      <div className="kpi"><div className="k">En ascenso</div><div className="v" style={{ color: rising.length ? "var(--rise)" : undefined }}>{rising.length}<small> / {main.length}</small></div>
        <div className="d">{rising.length ? rising.map((s) => s.name).join(", ") : "Ninguna estación principal"}</div></div>
      <div className="kpi"><div className="k">Lluvia máx. 24 h</div><div className="v">{maxR ? num(maxR.windows["24h"].mm, 1) : "—"}<small> mm</small></div>
        <div className="d">{maxR ? maxR.name : "sin datos"}{max72?.windows["72h"].mm ? ` · 72 h: ${num(max72.windows["72h"].mm, 1)} mm (${max72.name})` : ""}</div></div>
      <div className="kpi"><div className="k">Indicadores automáticos</div><div className="v" style={{ color: act.length ? "var(--fall)" : undefined }}>{act.length}</div>
        <div className="d">{act.length ? "criterio propio, no oficial" : "ninguno activo"}</div></div>
    </div>
  );
}

/** Perfil esquemático: estaciones de aguas arriba a aguas abajo, terminando en el dique. */
export function RiverProfile({ main, prop, dam }: { main: Station[]; prop: any; dam: any }) {
  const nodes = main;
  const n = nodes.length + 1;
  const W = 1000, padX = 60, y0 = 78;
  const xs = Array.from({ length: n }, (_, i) => padX + (i * (W - 2 * padX)) / (n - 1));
  const river = `M${xs[0]},${y0} L${xs[n - 1]},${y0}`;
  const pairs: any[] = prop?.pairs || [];
  const all: any[] = [...pairs, ...(prop?.direct || [])];
  const lagFor = (a: string, b: string) => all.find((p) => p.from === a && p.to === b && p.ok);
  const lagTxt = (l: any) => (l.lag_range_h[0] === l.lag_range_h[1] ? `~${l.lag_range_h[0]} h` : `~${l.lag_range_h[0]}–${l.lag_range_h[1]} h`);
  const lagTip = (l: any) => [
    l.ev_lag_h != null ? `Crecidas pasadas: mediana ${l.ev_lag_h} h entre picos (${l.n_events} crecidas).` : null,
    l.corr_lag_h != null ? `Correlación: máximo en ${l.corr_lag_h} h (r ${l.r}).` : null,
    l.note ? `Atención: ${l.note}.` : null,
    `Confianza ${l.confidence}. Estimación estadística.`].filter(Boolean).join(" ");
  const first = nodes[0], last = nodes[nodes.length - 1];
  let total: { txt: string; tip: string } | null = null;
  if (first && last && first !== last) {
    const d = lagFor(first.key, last.key);
    if (d) total = { txt: lagTxt(d), tip: lagTip(d) };
    else {
      let lo = 0, hi = 0, ok = true;
      for (let i = 0; i + 1 < nodes.length && ok; i++) { const l = lagFor(nodes[i].key, nodes[i + 1].key); if (!l) ok = false; else { lo += l.lag_range_h[0]; hi += l.lag_range_h[1]; } }
      if (ok) total = { txt: `~${lo}–${hi} h`, tip: "Suma de los tramos. Estimación estadística." };
    }
  }
  const cota = dam?.variables?.cota;
  const line = cssVar("var(--line-2)"), accent = cssVar("var(--accent)");
  return (
    <div className="card profile" style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} 166`} style={{ minWidth: 720 }} role="img" aria-label="Perfil de la cuenca">
        <defs>
          <linearGradient id="rv" x1="0" x2="1"><stop offset="0" stopColor={accent} stopOpacity=".35" /><stop offset="1" stopColor={accent} stopOpacity=".8" /></linearGradient>
        </defs>
        <path d={river} stroke="url(#rv)" strokeWidth={6} strokeLinecap="round" fill="none" />
        {xs.slice(0, -1).map((x, i) => {
          const a = nodes[i], b = nodes[i + 1];
          const lag = b ? lagFor(a.key, b.key) : null;
          const mid = (x + xs[i + 1]) / 2;
          return (
            <g key={i}>
              <path d={`M${mid - 5},${y0 - 5} L${mid + 3},${y0} L${mid - 5},${y0 + 5}`} stroke={cssVar("var(--bg)")} strokeWidth={2} fill="none" />
              {b && <text x={mid} y={y0 - 12} textAnchor="middle" className="sub">{lag ? lagTxt(lag) : "sin estimar"}<title>{lag ? lagTip(lag) : "No hay suficientes crecidas pasadas registradas en las dos estaciones para estimar la demora de este tramo."}</title></text>}
            </g>
          );
        })}
        {nodes.map((s, i) => {
          const c = cssVar(STATUS_VAR[s.status?.code || ""] || "var(--stale)");
          const d24 = s.level?.changes["24h"]?.delta_m;
          return (
            <g key={s.key}>
              <text x={xs[i]} y={30} textAnchor="middle" className="lbl">{s.name}</text>
              <circle cx={xs[i]} cy={y0} r={11} fill={cssVar("var(--panel)")} stroke={c} strokeWidth={3} />
              <circle cx={xs[i]} cy={y0} r={4.5} fill={stationColor(s.key)} />
              <text x={xs[i]} y={y0 + 32} textAnchor="middle" className="val" style={{ fill: s.status?.code === "stale" ? cssVar("var(--muted)") : undefined }}>
                {s.level ? `${num(s.level.value)} m` : "s/d"}<title>Lectura de escala (no es profundidad), medida por el INA</title>
              </text>
              <text x={xs[i]} y={y0 + 48} textAnchor="middle" className="sub" style={{ fill: d24 == null || s.status?.code === "stale" ? undefined : d24 > 0.005 ? cssVar("var(--pos)") : undefined }}>
                {s.status?.code === "stale" ? `dato de hace ${Math.round((s.status as any).age_hours / 24)} d` : d24 == null ? "—" : `${cm(d24)} 24 h`}
              </text>
              {s.stats_brief?.clim?.ok && s.stats_brief.pct_class ? (
                <text x={xs[i]} y={y0 + 64} textAnchor="middle" className="sub" style={{ fill: cssVar(PCT_VAR[s.stats_brief.pct_class.code]), fontWeight: 700 }}>
                  {s.stats_brief.pct_class.label} para {s.stats_brief.clim.month_name}
                </text>
              ) : s.stats_brief?.clim?.ok && s.stats_brief.pct != null ? <text x={xs[i]} y={y0 + 64} textAnchor="middle" className="sub">P{Math.round(s.stats_brief.pct)} vs {s.stats_brief.clim.month_name} {s.stats_brief.clim.years[0]}–{s.stats_brief.clim.years[s.stats_brief.clim.years.length - 1].slice(2)}</text>
                : <text x={xs[i]} y={y0 + 64} textAnchor="middle" className="sub">sin clase (registro corto)</text>}
            </g>
          );
        })}
        <g>
          <text x={xs[n - 1]} y={30} textAnchor="middle" className="lbl">Dique F. Ameghino</text>
          <rect x={xs[n - 1] - 14} y={y0 - 14} width={28} height={28} rx={6} fill={cssVar("var(--panel-3)")} stroke={line} strokeWidth={2} />
          <rect x={xs[n - 1] - 3} y={y0 - 9} width={6} height={18} rx={1.5} fill={accent} />
          <text x={xs[n - 1]} y={y0 + 32} textAnchor="middle" className="val">{cota?.available ? `${num(cota.last.value, cota.last.approx ? 0 : 2)} m${cota.last.approx ? " aprox." : ""}` : "cota s/d"}</text>
          <text x={xs[n - 1]} y={y0 + 48} textAnchor="middle" className="sub">{cota?.available ? `prensa · hace ${Math.round(cota.age_days)} d` : "sin dato público"}</text>
        </g>
      </svg>
      {total && <div className="small muted" style={{ padding: "0 8px 4px" }} title={total.tip}>
        Un pico en {first.name} tarda {total.txt} en llegar a {last.name} <span className="tag tag-est">ESTIMADO</span> · demora entre picos según crecidas pasadas
      </div>}
    </div>
  );
}
