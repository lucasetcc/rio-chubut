import { useEffect, useState } from "react";
import ReactECharts from "./EChart";
import { api } from "../api";
import { cssVar, esc, num } from "../fmt";

const CLS_VAR: Record<string, string> = { vlow: "var(--neg)", low: "var(--neg)", normal: "var(--ok)", high: "var(--pos)", vhigh: "var(--pos)" };
const GRADE_VAR: Record<string, string> = { buena: "var(--ok)", regular: "var(--s4)", mala: "var(--neg)", "sin datos": "var(--muted)" };
const q = (v: number | null | undefined) => (v == null ? "—" : num(v, v < 10 ? 1 : 0));

/** Caudal MODELADO por GloFAS. Pestaña aparte: no modifica ningún otro dato de la página. */
export function GlofasPanel() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState("las_plumas");
  useEffect(() => { api.glofas().then(setD).catch((e) => setErr(String(e.message || e))); }, []);

  if (err) return <div className="card"><div className="msg warn">No se pudo consultar el modelo GloFAS: {err}. El resto de la página no se ve afectado.</div></div>;
  if (!d) return <div className="card muted">Consultando el modelo GloFAS…</div>;
  const ok = d.stations.filter((s: any) => !s.error);
  const pl = ok.find((s: any) => s.key === "las_plumas");
  const cur = ok.find((s: any) => s.key === sel) || ok[0];

  const option = cur && (() => {
    const t: string[] = cur.daily.time, ti = cur.ti;
    const ms = (s: string) => new Date(s + "T12:00:00-03:00").getTime();
    const line = cssVar("var(--line)"), muted = cssVar("var(--muted)"), acc = cssVar("var(--accent)");
    return {
      animation: false, grid: { left: 52, right: 16, top: 24, bottom: 36 },
      tooltip: { trigger: "axis", backgroundColor: cssVar("var(--panel)"), borderColor: line, textStyle: { color: cssVar("var(--text)") },
        formatter: (ps: any[]) => { const i = ps[0].dataIndex, b = cur.band[i];
          const v = i <= ti ? `Modelo: <b>${q(cur.daily.river_discharge[i])} m³/s</b>` : `Pronóstico (mediana): <b>${q(cur.daily.river_discharge_median?.[i])} m³/s</b><br/>50 % central: ${q(cur.daily.river_discharge_p25?.[i])}–${q(cur.daily.river_discharge_p75?.[i])}`;
          return `${esc(t[i])}${i === ti ? " (hoy)" : ""}<br/>${v}<br/><span style="color:${muted}">Normal para la fecha: ${q(b.p25)}–${q(b.p75)} m³/s</span>`; } },
      xAxis: { type: "time", axisLabel: { color: muted, hideOverlap: true }, axisLine: { lineStyle: { color: line } } },
      yAxis: { type: "value", name: "m³/s", nameTextStyle: { color: muted }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: line, opacity: 0.6 } } },
      series: [
        { type: "line", data: cur.band.map((b: any) => [ms(b.date), b.p25]), stack: "n", symbol: "none", lineStyle: { opacity: 0 }, silent: true },
        { type: "line", data: cur.band.map((b: any) => [ms(b.date), b.p75 != null && b.p25 != null ? b.p75 - b.p25 : null]), stack: "n", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: muted, opacity: 0.18 }, silent: true },
        { type: "line", data: t.map((x, i) => [ms(x), i >= ti ? cur.daily.river_discharge_p25?.[i] ?? null : null]), stack: "f", symbol: "none", lineStyle: { opacity: 0 }, silent: true },
        { type: "line", data: t.map((x, i) => [ms(x), i >= ti && cur.daily.river_discharge_p75?.[i] != null ? cur.daily.river_discharge_p75[i] - (cur.daily.river_discharge_p25?.[i] ?? 0) : null]), stack: "f", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: acc, opacity: 0.2 }, silent: true },
        { type: "line", data: t.map((x, i) => [ms(x), i >= ti ? cur.daily.river_discharge_median?.[i] ?? null : null]), symbol: "none", lineStyle: { width: 2, type: "dashed", color: acc } },
        { type: "line", data: t.map((x, i) => [ms(x), i <= ti ? cur.daily.river_discharge[i] : null]), symbol: "none", lineStyle: { width: 2, color: acc },
          markLine: { symbol: "none", silent: true, label: { formatter: "hoy", color: muted }, lineStyle: { color: muted, type: "dotted" }, data: [{ xAxis: ms(d.today) }] } },
      ],
    };
  })();

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="msg warn"><b>MODELADO, no medido.</b> GloFAS (Copernicus) estima el caudal con un modelo hidrológico global de ~5 km. No representa bien el riego ni la regulación del dique. Los niveles medidos del INA siguen siendo la referencia; esta pestaña no cambia ningún otro dato de la página.</div>

      {pl && <div className="kpis">
        <div className="kpi"><div className="k">Aporte estimado al dique hoy <span className="tag tag-est">MODELADO</span></div>
          <div className="v">{q(pl.now)}<small> m³/s</small></div><div className="d">≈ {num(pl.now * 0.0864, 2)} hm³ por día · Las Plumas</div></div>
        <div className="kpi"><div className="k">Vs mismo período {pl.first_year}–{Number(d.today.slice(0, 4)) - 1}</div>
          <div className="v" style={{ color: pl.cls ? cssVar(CLS_VAR[pl.cls.code]) : undefined }}>{pl.cls ? pl.cls.label : pl.pct == null ? "—" : `P${pl.pct}`}</div>
          <div className="d">percentil {pl.pct ?? "—"} · mediana {q(pl.median)} m³/s ({pl.years} años)</div></div>
        <div className="kpi"><div className="k">En 7 días (pronóstico)</div><div className="v">{q(pl.in7)}<small> m³/s</small></div><div className="d">mediana de 50 escenarios del modelo</div></div>
        <div className="kpi"><div className="k">Control del modelo</div><div className="v">{q(pl.mean)}<small> m³/s</small></div>
          <div className="d">media {pl.first_year}–hoy según GloFAS · publicada por Hidroeléctrica Ameghino: 47 m³/s</div></div>
      </div>}

      <div className="chain">
        {d.stations.map((s: any) => s.error ? (
          <div key={s.key} className="st-card"><h3>{s.name}</h3><div className="state err small">No se pudo consultar: {s.error}</div></div>
        ) : (
          <div key={s.key} className={`st-card clickable ${s.key === cur?.key ? "sel" : ""}`} role="button" tabIndex={0} onClick={() => setSel(s.key)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(s.key); } }}>
            <h3>{s.name}</h3>
            <div className="big">{q(s.now)}<small>m³/s</small></div>
            <div className="caption">Caudal modelado hoy <span className="tag tag-est">MODELADO</span></div>
            <div className="small" style={{ marginTop: 6 }}>
              {s.cls ? <b style={{ color: cssVar(CLS_VAR[s.cls.code]) }}>{s.cls.label}</b> : <span className="muted">sin clase</span>} · P{s.pct ?? "—"} vs {s.first_year}–{Number(d.today.slice(0, 4)) - 1}
            </div>
            <div className="small muted">En 7 días: {q(s.in7)} m³/s</div>
            <div className="small" style={{ marginTop: 6 }} title={`Correlación de rangos entre el caudal del modelo y el nivel medido por el INA, ${s.check.n} días en común`}>
              Coincide con el INA: <b style={{ color: cssVar(GRADE_VAR[s.check.grade]) }}>{s.check.grade}</b>{s.check.r != null ? ` (r ${num(s.check.r, 2)})` : ""}
            </div>
          </div>
        ))}
      </div>

      {cur && <div className="card">
        <h4 style={{ margin: "0 0 2px" }}>{cur.name} · caudal modelado (m³/s)</h4>
        <div className="small muted">Punto del modelo: {num(cur.glat, 3)}, {num(cur.glon, 3)}</div>
        <ReactECharts option={option} notMerge style={{ height: 360 }} />
        <div className="src">
          Línea: caudal modelado (últimos 60 días). Línea punteada y banda azul: pronóstico a 30 días (mediana y 50 % central de 50 escenarios).
          Banda gris: rango normal para esa fecha (P25–P75 de todos los años del modelo, ±15 días).
          “Coincide con el INA”: qué tanto sube y baja el caudal del modelo junto con el nivel medido (buena ≥ 0,7; regular 0,4–0,7; mala &lt; 0,4). Si es “mala”, no confíes en el modelo para esa estación.
          Fuente: <a href="https://open-meteo.com/en/docs/flood-api" target="_blank" rel="noreferrer">Open-Meteo Flood API</a>, datos GloFAS v4 del Copernicus Emergency Management Service.
        </div>
      </div>}
    </div>
  );
}
