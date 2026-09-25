import ReactECharts from "./EChart";
import { cssVar, esc, fDateTime, num } from "../fmt";

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

const srcTxt = (p: any) => [p.n_events ? `${p.n_events} crecidas` : null, p.r != null && p.corr_lag_h != null ? `r ${num(p.r, 2)}` : null].filter(Boolean).join(" · ") + (p.confidence ? ` · confianza ${p.confidence}` : "");

export function PropagationPanel({ prop }: { prop: any }) {
  if (!prop) return <div className="card muted">Calculando…</div>;
  const pairs: any[] = prop.pairs || [];
  const withEv = [...pairs, ...(prop.direct || [])].filter((p) => p.ok && p.events?.length);
  const shown = withEv.filter((p) => pairs.includes(p)).length ? withEv.filter((p) => pairs.includes(p)) : withEv;
  const cats = shown.map((p) => `${p.from_name} → ${p.to_name}`);
  const option = {
    animation: false,
    grid: { left: 8, right: 24, top: 10, bottom: 40, containLabel: true },
    xAxis: { type: "value", name: "horas entre picos", nameLocation: "middle", nameGap: 26, min: 0, nameTextStyle: { color: cssVar("var(--muted)") }, axisLabel: { color: cssVar("var(--muted)") }, splitLine: { lineStyle: { color: cssVar("var(--line)") } } },
    yAxis: { type: "category", data: cats, inverse: true, axisLabel: { color: cssVar("var(--text-2)") }, axisTick: { show: false } },
    tooltip: { trigger: "item", backgroundColor: cssVar("var(--panel)"), borderColor: cssVar("var(--line)"), textStyle: { color: cssVar("var(--text)") },
      formatter: (x: any) => `${esc(cats[x.value[1]])}<br/>Pico aguas arriba: ${fDateTime(x.data.e.up_peak)} (+${x.data.e.up_rise_cm} cm)<br/>Pico aguas abajo: ${fDateTime(x.data.e.down_peak)} (+${x.data.e.down_rise_cm} cm)<br/><b>${x.value[0]} h</b>` },
    series: [
      { type: "scatter", symbolSize: 9, itemStyle: { color: cssVar("var(--accent)"), opacity: 0.7 },
        data: shown.flatMap((p, i) => p.events.map((e: any) => ({ value: [e.lag_h, i], e }))) },
      { type: "scatter", symbol: "rect", symbolSize: [3, 22], itemStyle: { color: cssVar("var(--text)") },
        tooltip: { show: false }, data: shown.map((p, i) => [p.lag_h, i]) },
      { type: "scatter", symbol: "diamond", symbolSize: 13, itemStyle: { color: "transparent", borderColor: cssVar("var(--s4)"), borderWidth: 2 },
        tooltip: { formatter: (x: any) => `${esc(cats[x.value[1]])}<br/>Correlación: máximo en <b>${x.value[0]} h</b> (r ${num(shown[x.value[1]].r, 2)})` },
        data: shown.map((p, i) => (p.corr_lag_h != null ? [p.corr_lag_h, i] : null)).filter(Boolean) },
    ],
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
                    <span><b>{pairs[i].lag_range_h[0] === pairs[i].lag_range_h[1] ? pairs[i].lag_range_h[0] : `${pairs[i].lag_range_h[0]}–${pairs[i].lag_range_h[1]}`} h</b></span>
                    <div className="line" />
                    <span className="muted" title={pairs[i].note || ""}>{srcTxt(pairs[i])}</span>
                  </> : <><span className="muted">sin estimar</span><div className="line" /><span className="muted small">{pairs[i].reason}</span></>}
                </div>
              )}
            </div>
          ))}
        </div>
        {prop.excluded?.length > 0 && <div className="small muted">Sin datos en el INA: {prop.excluded.map((e: any) => e.name).join(", ")}.</div>}
        <h4 style={{ margin: "12px 0 6px", fontSize: 13 }}>Señales actuales <span className="tag tag-est">ESTIMADO</span></h4>
        {prop.signals.length === 0 ? <div className="msg info">No hay señales de subida en curso en la cadena principal.</div>
          : prop.signals.map((s: any) => (
            <div key={s.station} className="msg">
              {s.messages.map((m: string, i: number) => <div key={i}>{i === 0 ? <b>{m}</b> : m}</div>)}
              {s.downstream.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>
                {s.downstream.map((d: any) => d.peak_known ? `${d.to_name}: ${fDateTime(d.eta_from)} – ${fDateTime(d.eta_to)}` : `${d.to_name}: no antes de ${fDateTime(d.eta_from)}`).join(" · ")}
              </div>}
            </div>
          ))}
        <div className="disclaimer"><b>{prop.disclaimer}</b><br />{prop.method}</div>
      </div>
      {shown.length > 0 && (
        <div className="card">
          <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>Demora de cada crecida pasada</h4>
          <ReactECharts option={option} notMerge style={{ height: 70 + 44 * shown.length }} />
          <div className="src">● cada crecida registrada: horas entre el pico en una estación y el pico en la siguiente. ◇ desfase de máxima correlación de toda la serie. ▎ valor usado (combina ambos). Pasá el mouse para ver fechas.</div>
        </div>
      )}
      {(prop.direct || []).some((p: any) => p.ok) && (
        <div className="card">
          <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>Demoras entre estaciones no vecinas</h4>
          <div className="tablewrap"><table>
            <thead><tr><th>Desde</th><th>Hasta</th><th className="n">Demora</th><th className="n">Rango</th><th>Base</th></tr></thead>
            <tbody>{prop.direct.filter((p: any) => p.ok).map((p: any) => (
              <tr key={p.from + p.to}><td>{p.from_name}</td><td>{p.to_name}</td><td className="n">{p.lag_h} h</td><td className="n">{p.lag_range_h[0] === p.lag_range_h[1] ? p.lag_range_h[0] : `${p.lag_range_h[0]}–${p.lag_range_h[1]}`} h</td><td className="small muted">{srcTxt(p)}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
