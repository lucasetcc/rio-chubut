import ReactECharts from "./EChart";
import { useEffect, useState } from "react";
import { api, Station, Stats } from "../api";
import { cm, cssVar, esc, fDate, fDateTime, num } from "../fmt";

const WIN_LABEL: Record<string, string> = {
  "24h": "Últimas 24 h (datos crudos)", "7d": "Últimos 7 días completos", "7d_incl_hoy": "7 días incl. hoy (parcial)",
  "30d": "Últimos 30 días", "90d": "Últimos 90 días", "365d": "Últimos 365 días", historico: "Histórico disponible",
};
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function StatsPanel({ stations, selected, onSelect }: { stations: Station[]; selected: string; onSelect: (k: string) => void }) {
  const hydro = stations.filter((s) => s.has_level);
  const [st, setSt] = useState<Stats | null>(null);
  const [ql, setQl] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setSt(null); setErr(null);
    api.stats(selected).then(setSt).catch((e) => setErr(String(e)));
    api.quality(selected).then(setQl).catch(() => setQl(null));
  }, [selected]);
  const name = hydro.find((s) => s.key === selected)?.name;

  const cmpKeys = ["7d", "30d", "90d", "365d", "historico", "mismo_mes_hist"] as const;
  const cmpLabel: Record<string, string> = { "7d": "7 días", "30d": "30 días", "90d": "90 días", "365d": "12 meses", historico: "Histórico", mismo_mes_hist: "Mediana mismo mes" };
  const cmpData = st?.available ? cmpKeys.map((k) => ({ k, v: st.comparisons[k] })).filter((x) => x.v != null) : [];
  const pos = cssVar("var(--pos)"), neg = cssVar("var(--neg)");
  const option = {
    animation: false,
    grid: { left: 150, right: 60, top: 10, bottom: 24 },
    xAxis: { type: "value", axisLabel: { color: cssVar("var(--muted)"), formatter: (v: number) => `${Math.round(v * 100)} cm` }, splitLine: { lineStyle: { color: cssVar("var(--line)") } } },
    yAxis: { type: "category", inverse: true, data: cmpData.map((x) => cmpLabel[x.k]), axisLabel: { color: cssVar("var(--text-2)") }, axisLine: { lineStyle: { color: cssVar("var(--line)") } }, axisTick: { show: false } },
    tooltip: { trigger: "item", backgroundColor: cssVar("var(--panel)"), borderColor: cssVar("var(--line)"), textStyle: { color: cssVar("var(--text)") },
      formatter: (p: any) => `Actual vs promedio ${esc(p.name)}: <b>${cm(p.value)}</b>` },
    series: [{
      type: "bar", barWidth: 14,
      data: cmpData.map((x) => ({ value: x.v, itemStyle: { color: (x.v as number) >= 0 ? pos : neg, borderRadius: (x.v as number) >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
      label: { show: true, position: "right", color: cssVar("var(--text-2)"), formatter: (p: any) => cm(p.value) },
    }],
  };

  return (
    <div className="grid g2">
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <select value={selected} onChange={(e) => onSelect(e.target.value)}>
            {hydro.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <span className="spacer" />
          {st?.available && <span className="small muted">{st.history_days} días de historia desde {fDate(st.windows.historico.since)}</span>}
        </div>
        {err && <div className="err">{err}</div>}
        {st && !st.available && <div className="nodata">{st.reason}</div>}
        {st?.available && (
          <>
            <div style={{ fontSize: 15, lineHeight: 1.8 }}>
              <div>Lectura de escala: <b>{num(st.current.value)} m</b> <span className="small muted">({fDateTime(st.current.ts)} ART · medido INA)</span></div>
              <div>Promedio de hoy (parcial): <b>{num(st.today_mean)} m</b></div>
              <div>Promedio últimos 7 días: {st.windows["7d"].mean == null ? <span className="nodata">datos insuficientes ({st.windows["7d"].days_with_data}/7 días)</span> : <b>{num(st.windows["7d"].mean)} m</b>}</div>
              <div>Promedio últimos 30 días: {st.windows["30d"].mean == null ? <span className="nodata">datos insuficientes ({st.windows["30d"].days_with_data}/30 días)</span> : <b>{num(st.windows["30d"].mean)} m</b>}</div>
              {st.comparisons["30d"] != null && <div>Diferencia respecto al promedio de 30 días: <b>{cm(st.comparisons["30d"])}</b></div>}
              {(st.same_month_climatology as any).ok ? (
                <div>Mediana de {MONTHS[st.same_month_climatology.month - 1]} ({st.same_month_climatology.years.join(", ")}): <b>{num(st.same_month_climatology.median)} m</b> → actual {cm(st.comparisons.mismo_mes_hist)} · percentil <b>{num(st.percentile_rank_hist, 0)}</b></div>
              ) : <div className="muted">Sin comparación con años anteriores: {(st.same_month_climatology as any).reason}.</div>}
              <div className="small muted">Todo lo de esta sección es CALCULADO a partir de las lecturas del INA.</div>
            </div>
            <h4 style={{ margin: "14px 0 4px", fontSize: 13 }}>Diferencia del nivel actual respecto de cada promedio</h4>
            {cmpData.length ? <ReactECharts option={option} notMerge style={{ height: 36 * cmpData.length + 40 }} /> : <div className="nodata">Sin datos suficientes.</div>}
          </>
        )}
      </div>
      <div className="card tablewrap">
        <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Estadísticas {name}</h4>
        {st?.available && (
          <table>
            <thead><tr><th>Período</th><th className="n">Prom.</th><th className="n">Mín.</th><th className="n">Máx.</th><th className="n">Mediana</th><th className="n">P10</th><th className="n">P25</th><th className="n">P75</th><th className="n">P90</th><th className="n">Días</th></tr></thead>
            <tbody>
              {Object.keys(WIN_LABEL).map((k) => {
                const w = st.windows[k];
                if (!w) return null;
                return (
                  <tr key={k}>
                    <td>{WIN_LABEL[k]}</td>
                    {(["mean", "min", "max", "median", "p10", "p25", "p75", "p90"] as const).map((f) => <td key={f} className="n">{num(w[f])}</td>)}
                    <td className="n">{k === "24h" ? `${w.n} datos` : `${w.days_with_data ?? w.n}${w.days_expected ? `/${w.days_expected}` : ""}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="src" style={{ marginTop: 8 }}>{st?.method} Valores en metros de la escala local.</div>
        {ql && (
          <details style={{ marginTop: 12 }}>
            <summary>Calidad de datos</summary>
            <div className="small" style={{ marginTop: 6 }}>
              Registros: {ql.measurements.map((q: any) => `${q.quality}: ${q.n}`).join(" · ") || "—"}<br />
              Paso típico: {ql.typical_step_h ?? "—"} h · Huecos (90 d): {ql.gaps_90d.length} · Revisiones de la fuente: {ql.revisions.length}
            </div>
            {ql.gaps_90d.length > 0 && <div className="small muted">Huecos: {ql.gaps_90d.slice(0, 8).map((g: any) => `${fDateTime(g.from)} → ${fDateTime(g.to)} (${g.hours} h)`).join("; ")}</div>}
            {ql.issues.length > 0 && (
              <table style={{ marginTop: 6 }}>
                <tbody>{ql.issues.slice(0, 15).map((i: any) => <tr key={i.id}><td className="small">{fDateTime(i.ts)}</td><td className="small">{i.issue}</td><td className="small">{i.detail}</td></tr>)}</tbody>
              </table>
            )}
          </details>
        )}
      </div>
    </div>
  );
}
