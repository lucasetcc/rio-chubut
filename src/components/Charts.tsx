import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";
import { api, Station } from "../api";
import { cssVar, fDate, fDateTime, isoDaysAgo, num, stationColor } from "../fmt";

export const RANGES = [
  { k: "24h", label: "24 h", days: 1, agg: "raw" },
  { k: "7d", label: "7 días", days: 7, agg: "raw" },
  { k: "30d", label: "30 días", days: 30, agg: "raw" },
  { k: "90d", label: "90 días", days: 90, agg: "raw" },
  { k: "1a", label: "12 meses", days: 365, agg: "daily" },
  { k: "hist", label: "Histórico", days: 365 * 30, agg: "daily" },
] as const;

export function baseAxis() {
  const muted = cssVar("var(--muted)"), line = cssVar("var(--line)"), text2 = cssVar("var(--text-2)");
  return {
    textStyle: { color: text2, fontFamily: "inherit" },
    grid: { left: 52, right: 16, top: 30, bottom: 70 },
    xAxis: { type: "time", axisLine: { lineStyle: { color: line } }, axisLabel: { color: muted, hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: "value", scale: true, axisLabel: { color: muted }, splitLine: { lineStyle: { color: line, opacity: 0.6 } } },
    tooltipBase: { backgroundColor: cssVar("var(--panel)"), borderColor: line, textStyle: { color: cssVar("var(--text)") } },
  };
}

type Loaded = { key: string; name: string; points: [number, number, string][] };

export function LevelChart({ stations, initial }: { stations: Station[]; initial: string }) {
  const hydro = stations.filter((s) => s.has_level);
  const [range, setRange] = useState<(typeof RANGES)[number]["k"]>("30d");
  const [sel, setSel] = useState<string[]>([initial]);
  const [data, setData] = useState<Loaded[]>([]);
  const [hist, setHist] = useState<[number, number][] | null>(null);
  const [showBdhi, setShowBdhi] = useState(false);
  const [loading, setLoading] = useState(false);
  const r = RANGES.find((x) => x.k === range)!;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(
      sel.map(async (k) => {
        const st = hydro.find((s) => s.key === k)!;
        const h = await api.history(k, isoDaysAgo(r.days), r.agg);
        const pts: [number, number, string][] = r.agg === "daily"
          ? h.data.map((d: any) => [new Date(d.date + "T12:00:00-03:00").getTime(), d.mean, `promedio diario (${d.n} datos)`])
          : h.data.map((d: any) => [new Date(d.ts).getTime(), d.value, d.quality]);
        return { key: k, name: st?.name || k, points: pts };
      }),
    ).then((res) => alive && setData(res)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [sel.join(","), range]);

  useEffect(() => {
    if (!showBdhi || sel.length !== 1) { setHist(null); return; }
    api.history(sel[0], isoDaysAgo(365 * 30), "daily", "level_hist")
      .then((h) => setHist(h.data.map((d: any) => [new Date(d.date + "T12:00:00-03:00").getTime(), d.mean])))
      .catch(() => setHist(null));
  }, [showBdhi, sel.join(",")]);

  const single = sel.length === 1 ? hydro.find((s) => s.key === sel[0]) : undefined;
  const option = useMemo(() => {
    const b = baseAxis();
    const series: any[] = data.map((d) => ({
      name: d.name, type: "line", showSymbol: d.points.length < 60, symbolSize: 6, sampling: "lttb",
      lineStyle: { width: 2, color: stationColor(d.key) }, itemStyle: { color: stationColor(d.key) },
      data: d.points.map((p) => ({ value: [p[0], p[1]], q: p[2] })),
      markLine: single && d.key === single.key && single.stats_brief ? {
        symbol: "none", silent: true, label: { color: cssVar("var(--muted)"), formatter: "{b}", position: "insideEndTop" },
        lineStyle: { type: "dashed", color: cssVar("var(--muted)"), width: 1 },
        data: [
          single.stats_brief.avg_7d != null ? { name: `prom. 7 d ${num(single.stats_brief.avg_7d)} m`, yAxis: single.stats_brief.avg_7d } : null,
          single.stats_brief.avg_30d != null ? { name: `prom. 30 d ${num(single.stats_brief.avg_30d)} m`, yAxis: single.stats_brief.avg_30d } : null,
        ].filter(Boolean),
      } : undefined,
    }));
    if (hist && hist.length) {
      series.push({ name: "BDHI diaria (histórico)", type: "line", showSymbol: false, lineStyle: { width: 1.5, type: "dotted", color: cssVar("var(--muted)") },
        itemStyle: { color: cssVar("var(--muted)") }, data: hist.map((p) => ({ value: p, q: "BDHI" })) });
    }
    return {
      animation: false,
      textStyle: b.textStyle, grid: b.grid, xAxis: b.xAxis,
      yAxis: { ...b.yAxis, name: "Nivel (m)", nameTextStyle: { color: cssVar("var(--muted)") } },
      legend: { show: series.length > 1, top: 0, textStyle: { color: cssVar("var(--text-2)") }, icon: "roundRect" },
      tooltip: {
        trigger: "axis", ...b.tooltipBase, axisPointer: { type: "cross", label: { backgroundColor: cssVar("var(--panel-2)") } },
        formatter: (ps: any[]) => {
          if (!ps.length) return "";
          const t = ps[0].value[0];
          const head = r.agg === "daily" ? `<b>${fDate(new Date(t).toISOString())}</b> (promedio diario)` : `<b>${fDateTime(new Date(t).toISOString())}</b>`;
          const rows = ps.map((p) => `${p.marker} ${p.seriesName}: <b>${num(p.value[1])} m</b>${p.data.q && p.data.q !== "VALID" && r.agg !== "daily" ? ` <span style="opacity:.7">(${p.data.q})</span>` : ""}`);
          return `${head}<br/>${rows.join("<br/>")}<br/><span style="opacity:.7">Caudal: sin datos públicos · Fuente: INA</span>`;
        },
      },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 22, bottom: 12, borderColor: cssVar("var(--line)"), textStyle: { color: cssVar("var(--muted)") } }],
      series,
    };
  }, [data, hist, single?.key]);

  const toggle = (k: string) => setSel((cur) => (cur.includes(k) ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur) : [...cur, k]));

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="tabs">
          {RANGES.map((x) => <button key={x.k} className={x.k === range ? "on" : ""} onClick={() => setRange(x.k)}>{x.label}</button>)}
        </div>
        <span className="spacer" />
        {sel.length === 1 && hydro.find((s) => s.key === sel[0])?.series.some((x) => x.role === "level_hist") && (
          <label className="chip"><input type="checkbox" checked={showBdhi} onChange={(e) => setShowBdhi(e.target.checked)} /> Serie histórica BDHI</label>
        )}
        {loading && <span className="small muted">cargando…</span>}
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small muted">Estaciones (clic para superponer):</span>
        {hydro.map((s) => (
          <span key={s.key} className={`chip ${sel.includes(s.key) ? "on" : ""}`} onClick={() => toggle(s.key)}>
            <span className="swatch" style={{ background: stationColor(s.key), opacity: sel.includes(s.key) ? 1 : 0.35 }} />{s.name}
          </span>
        ))}
        {sel.length > 1 && <button className="small" onClick={() => setSel([sel[0]])}>Una sola</button>}
        <button className="small" onClick={() => setSel(hydro.filter((s) => s.main).sort((a, b) => (a.chain_order || 0) - (b.chain_order || 0)).map((s) => s.key))}>
          Cadena principal
        </button>
      </div>
      <ReactECharts option={option} notMerge style={{ height: 380 }} />
      <div className="src">
        {r.agg === "daily" ? "Promedios diarios (hora argentina). " : "Datos crudos del INA. "}
        Cada estación tiene su propio cero de escala: al superponer, compará la forma y el momento de las subidas, no los valores absolutos.
        {showBdhi && " La serie BDHI (Red Hidrológica Nacional – SSRH) puede tener otro cero que la estación telemétrica."}
      </div>
    </div>
  );
}
