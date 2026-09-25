import ReactECharts from "./EChart";
import { cssVar, fDateTime, num } from "../fmt";

export function FloodPanel({ floods }: { floods: any[] }) {
  const msgs = floods.flatMap((f) => f.messages.map((m: string) => ({ k: f.key, m: m.replace(/^⚠️\s*/, ""), warn: m.startsWith("⚠"), avg: m.includes("promedio de los últimos 30") })));
  const main = msgs.filter((x) => !x.avg);
  const avg = msgs.filter((x) => x.avg);
  return (
    <div className="card">
      <h4>Subidas detectadas <span className="tag tag-calc">CRITERIO PROPIO</span></h4>
      {main.length === 0 ? <div className="msg info">No se detectan subidas rápidas ni sostenidas en las estaciones con datos.</div>
        : main.map((x, i) => <div key={i} className={`msg ${x.warn ? "warn" : "info"}`}>{x.m}</div>)}
      {avg.length > 0 && (
        <details style={{ margin: "6px 0" }}>
          <summary className="small">Comparación con el promedio de 30 días ({avg.length})</summary>
          {avg.map((x, i) => <div key={i} className="msg info small">{x.m}</div>)}
        </details>
      )}
      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Estación</th><th>Último dato</th><th className="n">6 h</th><th className="n">12 h</th><th className="n">24 h</th><th className="n">cm/h</th><th className="n">cm/día</th><th>Rápida</th><th>Sostenida</th><th className="n">Máx 24 h</th><th className="n">Máx 7 d</th><th className="n">Máx 30 d</th></tr></thead>
          <tbody>
            {floods.map((f) => (
              <tr key={f.key}>
                <td>{f.name}</td>
                <td className={`small ${f.stale ? "stale-note" : "muted"}`}>{fDateTime(f.last_ts)}{f.stale ? " · sin actualizar" : ""}</td>
                {["6h", "12h", "24h"].map((k) => <td key={k} className="n">{f.rise_cm[k] == null ? "—" : `${f.rise_cm[k] > 0 ? "+" : ""}${num(f.rise_cm[k], 0)} cm`}</td>)}
                <td className="n">{num(f.rate_cm_h, 2)}</td>
                <td className="n">{num(f.rate_cm_day, 1)}</td>
                <td>{f.rapid_rise ? "Sí" : "No"}</td>
                <td>{f.sustained_rise ? "Sí" : "No"}</td>
                {["24h", "7d", "30d"].map((k) => <td key={k} className="n" title={fDateTime(f[`max_${k}`]?.ts)}>{num(f[`max_${k}`]?.value)} m{f[`max_${k}`]?.is_current ? " ●" : ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="disclaimer">Criterio propio, no oficial. Superar un promedio no implica emergencia. Estaciones sin actualizar no se evalúan. “Rápida”: subida en 6 h ≥ umbral configurado; “sostenida”: ≥75 % de los pasos en ascenso en 24 h y subida ≥ umbral. ● = el máximo es el dato actual.</div>
    </div>
  );
}

export function PropagationPanel({ prop }: { prop: any }) {
  if (!prop) return <div className="card muted">Calculando…</div>;
  const pairs: any[] = prop.pairs || [];
  const option = {
    animation: false,
    grid: { left: 48, right: 16, top: 34, bottom: 40 },
    legend: { top: 0, textStyle: { color: cssVar("var(--text-2)") } },
    xAxis: { type: "value", name: "desfase (h)", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: cssVar("var(--muted)") }, axisLabel: { color: cssVar("var(--muted)") }, splitLine: { show: false } },
    yAxis: { type: "value", name: "r", min: -0.2, max: 1, axisLabel: { color: cssVar("var(--muted)") }, splitLine: { lineStyle: { color: cssVar("var(--line)") } } },
    tooltip: { trigger: "axis", backgroundColor: cssVar("var(--panel)"), borderColor: cssVar("var(--line)"), textStyle: { color: cssVar("var(--text)") },
      valueFormatter: (v: number) => num(v, 2) },
    series: pairs.filter((p) => p.ok).map((p, i) => ({
      name: `${p.from_name} → ${p.to_name}`, type: "line", showSymbol: false,
      lineStyle: { width: 2, color: cssVar(`var(--s${i + 1})`) }, itemStyle: { color: cssVar(`var(--s${i + 1})`) },
      data: p.curve.map((c: any) => [c.lag_h, c.r]),
    })),
  };
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card">
        <div className="flow">
          {prop.chain.map((c: any, i: number) => (
            <div key={c.key} style={{ display: "contents" }}>
              <div className="node"><b>{c.name}</b></div>
              {i < pairs.length && (
                <div className="edge">
                  {pairs[i].ok ? <>
                    <span><b>{pairs[i].lag_range_h[0]}–{pairs[i].lag_range_h[1]} h</b></span>
                    <div className="line" />
                    <span className="muted">r = {num(pairs[i].r, 2)}</span>
                  </> : <><span className="muted">sin estimar</span><div className="line" /><span className="muted small">{pairs[i].reason}</span></>}
                </div>
              )}
            </div>
          ))}
        </div>
        {prop.excluded?.length > 0 && <div className="small muted">Fuera de la cadena (sin datos recientes): {prop.excluded.map((e: any) => e.name).join(", ")}.</div>}
        <h4 style={{ margin: "12px 0 6px", fontSize: 13 }}>Señales actuales <span className="tag tag-est">ESTIMADO</span></h4>
        {prop.signals.length === 0 ? <div className="msg info">No hay señales de subida en curso en la cadena principal.</div>
          : prop.signals.map((s: any) => (
            <div key={s.station} className="msg">
              {s.messages.map((m: string, i: number) => <div key={i}>{i === 0 ? <b>{m}</b> : m}</div>)}
              {s.downstream.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>
                {s.downstream.map((d: any) => `${d.to_name}: ${fDateTime(d.eta_from)} – ${fDateTime(d.eta_to)}`).join(" · ")}
              </div>}
            </div>
          ))}
        <div className="disclaimer"><b>{prop.disclaimer}</b><br />{prop.method}</div>
      </div>
      {pairs.some((p) => p.ok) && (
        <div className="card">
          <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>Correlación en función del desfase</h4>
          <ReactECharts option={option} notMerge style={{ height: 300 }} />
          <div className="src">El pico de cada curva es el tiempo de viaje más probable entre esas dos estaciones según los datos históricos.</div>
        </div>
      )}
    </div>
  );
}
