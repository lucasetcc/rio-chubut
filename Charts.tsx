import ReactECharts from "./EChart";
import { useEffect, useMemo, useState } from "react";
import { api, Station } from "../api";
import { cssVar, dev, esc, fDate, fDateTime, isoDaysAgo, num, stationColor } from "../fmt";

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

export function LevelChart({ stations, initial, single: only }: { stations: Station[]; initial: string; single?: boolean }) {
  const hydro = stations.filter((s) => s.has_level);
  const [range, setRange] = useState<(typeof RANGES)[number]["k"]>("30d");
  const [sel, setSel] = useState<string[]>([initial]);
  const [data, setData] = useState<Loaded[]>([]);
  const [hist, setHist] = useState<[number, number][] | null>(null);
  const [showBdhi, setShowBdhi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [anomSel, setAnom] = useState<boolean | null>(null); // null = automático (desvío si hay varias estaciones)
  const anom = anomSel ?? sel.length > 1;
  const median = (k: string) => hydro.find((s) => s.key === k)?.stats_brief?.hist?.median ?? null;
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
    // Corta la línea en los huecos (no inventa continuidad) y separa los puntos SOSPECHOSOS.
    const buildLine = (d: Loaded) => {
      const m = median(d.key);
      const tr = (v: number) => (anom && m != null ? v - m : v);
      const good = d.points.filter((p) => r.agg === "daily" || p[2] === "VALID");
      const steps = good.slice(1).map((p, i) => p[0] - good[i][0]).sort((a, b) => a - b);
      const step = steps.length ? steps[Math.floor(steps.length / 2)] : 4 * 3600e3;
      const gap = Math.max(3 * step, 12 * 3600e3);
      const out: any[] = [];
      good.forEach((p, i) => {
        if (i && p[0] - good[i - 1][0] > gap) out.push({ value: [good[i - 1][0] + 1, null] });
        out.push({ value: [p[0], tr(p[1])], q: p[2], raw: p[1] });
      });
      const sus = r.agg === "daily" ? [] : d.points.filter((p) => p[2] !== "VALID").map((p) => ({ value: [p[0], tr(p[1])], q: p[2], raw: p[1] }));
      return { out, sus };
    };
    const built = data.map((d) => ({ d, ...buildLine(d) }));
    const series: any[] = built.map(({ d, out }) => ({
      name: d.name, type: "line", showSymbol: out.length < 60, symbolSize: 6, connectNulls: false,
      lineStyle: { width: 2, color: stationColor(d.key) }, itemStyle: { color: stationColor(d.key) },
      data: out,
      markLine: !anom && single && d.key === single.key && single.stats_brief ? {
        symbol: "none", silent: true, label: { color: cssVar("var(--muted)"), formatter: "{b}", position: "insideEndTop" },
        lineStyle: { type: "dashed", color: cssVar("var(--muted)"), width: 1 },
        data: [
          single.stats_brief.avg_7d != null ? { name: `prom. 7 d ${num(single.stats_brief.avg_7d)} m`, yAxis: single.stats_brief.avg_7d } : null,
          single.stats_brief.avg_30d != null ? { name: `prom. 30 d ${num(single.stats_brief.avg_30d)} m`, yAxis: single.stats_brief.avg_30d } : null,
        ].filter(Boolean),
      } : undefined,
    }));
    for (const { d, sus } of built) if (sus.length) series.push({ name: `${d.name} (sospechoso)`, type: "scatter", symbol: "triangle", symbolSize: 8,
      itemStyle: { color: cssVar("var(--muted)") }, data: sus });
    if (hist && hist.length && !anom) {
      series.push({ name: "BDHI diaria (histórico)", type: "line", showSymbol: false, lineStyle: { width: 1.5, type: "dotted", color: cssVar("var(--muted)") },
        itemStyle: { color: cssVar("var(--muted)") }, data: hist.map((p) => ({ value: p, q: "BDHI" })) });
    }
    return {
      animation: false,
      textStyle: b.textStyle, grid: b.grid, xAxis: b.xAxis,
      yAxis: { ...b.yAxis, name: anom ? "vs mediana del registro (m)" : "Escala (m)", nameTextStyle: { color: cssVar("var(--muted)") } },
      legend: { show: series.length > 1, top: 0, textStyle: { color: cssVar("var(--text-2)") }, icon: "roundRect" },
      tooltip: {
        trigger: "axis", ...b.tooltipBase, axisPointer: { type: "cross", label: { backgroundColor: cssVar("var(--panel-2)") } },
        formatter: (ps: any[]) => {
          if (!ps.length) return "";
          const t = ps[0].value[0];
          const head = r.agg === "daily" ? `<b>${fDate(new Date(t).toISOString())}</b> (promedio diario)` : `<b>${fDateTime(new Date(t).toISOString())}</b>`;
          const rows = ps.filter((p) => p.value[1] != null).map((p) => `${p.marker} ${esc(p.seriesName)}: <b>${anom && p.data.raw != null && p.value[1] !== p.data.raw ? `${dev(p.value[1])} vs mediana</b> (escala ${num(p.data.raw)} m)` : `${num(p.value[1])} m</b>`}${p.data.q && p.data.q !== "VALID" && r.agg !== "daily" ? ` <span style="opacity:.7">(${esc(p.data.q)} — no se usa en cálculos)</span>` : ""}`);
          return `${head} ART<br/>${rows.join("<br/>")}<br/><span style="opacity:.7">Lectura de escala medida por el INA (no es profundidad)</span>`;
        },
      },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 22, bottom: 12, borderColor: cssVar("var(--line)"), textStyle: { color: cssVar("var(--muted)") } }],
      series,
    };
  }, [data, hist, single?.key, anom]);

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
        {!only && <label className="chip" title="Resta a cada estación la mediana de su registro: sirve para comparar la forma y el momento de las subidas (CALCULADO)"><input type="checkbox" checked={anom} onChange={(e) => setAnom(e.target.checked)} /> Centrar en la mediana de cada estación</label>}
        {loading && <span className="small muted">cargando…</span>}
      </div>
      {!only && <div className="row" style={{ marginBottom: 8 }}>
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
      </div>}
      <ReactECharts option={option} notMerge style={{ height: 380 }} />
      <div className="src">
        {r.agg === "daily" ? "Promedios diarios (hora argentina). " : "Datos del INA; los huecos se muestran cortando la línea y los puntos sospechosos como ▲ gris. "}
        {anom ? "Cada curva muestra cuánto está esa estación por encima o por debajo de la mediana de su propio registro (0 = mediana; no es un “normal” oficial). Sirve para comparar forma y momento de las subidas." : "Lectura de escala: el cero de cada estación es arbitrario (no es profundidad) y no se compara entre estaciones."}
        {showBdhi && " La serie BDHI (Red Hidrológica Nacional – SSRH) puede tener otro cero que la estación telemétrica."}
      </div>
    </div>
  );
}
