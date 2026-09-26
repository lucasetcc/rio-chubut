import { useEffect, useState } from "react";
import ReactECharts from "./EChart";
import { api } from "../api";
import { cssVar, esc, num } from "../fmt";

const CLS_VAR: Record<string, string> = { vlow: "var(--neg)", low: "var(--neg)", normal: "var(--ok)", high: "var(--pos)", vhigh: "var(--pos)" };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  const trend = (now: number | null, fut: number | null) => (now == null || fut == null ? "—" : fut > now * 1.1 ? "↑ va a subir" : fut < now * 0.9 ? "↓ va a bajar" : "→ estable");
  const clsTxt = (s: any) => (s.cls ? <b style={{ color: cssVar(CLS_VAR[s.cls.code]) }}>{s.cls.label}</b> : <span className="muted">sin comparación</span>);
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="small muted">Estimación de un modelo, no una medición. Sirve para ver la tendencia; los niveles medidos del INA siguen siendo la referencia.</div>

      {pl && <div className="card" style={{ fontSize: 18, lineHeight: 1.55 }}>
        Hoy le entran al dique unos <b style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em" }}>{q(pl.now)} m³/s</b> <span className="muted">(≈ {num(pl.now * 0.0864, 1)} hm³ por día)</span>.<br />
        Para esta época del año eso es {clsTxt(pl)}. Próxima semana: <b>{trend(pl.now, pl.in7).replace(/^. /, "")}</b>{pl.in7 != null ? ` (~${q(pl.in7)} m³/s)` : ""}.
      </div>}

      <div className="card tablewrap" style={{ padding: 0 }}>
        <table className="glofas-table">
          <thead><tr><th>Estación</th><th className="n">Caudal hoy</th><th>Para la época</th><th>Próxima semana</th></tr></thead>
          <tbody>
            {d.stations.map((s: any) => s.error ? (
              <tr key={s.key}><td>{s.name}</td><td colSpan={3} className="muted">sin datos del modelo</td></tr>
            ) : (
              <tr key={s.key} className={`clickrow ${s.key === cur?.key ? "sel" : ""}`} tabIndex={0} onClick={() => setSel(s.key)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(s.key); } }}>
                <td><b>{s.name}</b>{s.key === "las_plumas" ? <span className="muted"> (llega al dique)</span> : null}</td>
                <td className="n"><b style={{ fontSize: 16 }}>{q(s.now)}</b> <span className="muted small">m³/s</span></td>
                <td>{clsTxt(s)}</td>
                <td>{trend(s.now, s.in7)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cur && <div className="card">
        <h4 style={{ margin: "0 0 2px" }}>{cur.name}: caudal estimado (m³/s)</h4>
        <ReactECharts option={option} notMerge style={{ height: 340 }} />
        <div className="legend-simple">
          <span><i style={{ background: cssVar("var(--accent)") }} />Últimos 60 días</span>
          <span><i style={{ background: "transparent", borderTop: `2px dashed ${cssVar("var(--accent)")}`, height: 0, borderRadius: 0 }} />Pronóstico</span>
          <span><i style={{ background: cssVar("var(--muted)"), opacity: 0.35 }} />Lo normal para cada fecha</span>
        </div>
      </div>}

      <details className="card">
        <summary><b>Detalles técnicos</b></summary>
        <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Fuente: modelo GloFAS v4 (Copernicus, Unión Europea) vía <a href="https://open-meteo.com/en/docs/flood-api" target="_blank" rel="noreferrer">Open-Meteo</a>. Cuadrícula de ~5 km; no representa bien el riego ni la regulación del dique.</li>
          <li>"Bajo / normal / alto": compara el caudal de hoy con el mismo período (±15 días) de todos los años desde {pl?.first_year ?? "1984"}. Normal = entre el 25 % y el 75 % de los años.</li>
          <li>Pronóstico: mediana de 50 escenarios del modelo. La banda azul del gráfico es el 50 % central de esos escenarios.</li>
          {pl && <li>Control: según el modelo, el caudal medio en Las Plumas desde {pl.first_year} es {q(pl.mean)} m³/s; Hidroeléctrica Ameghino publica 47 m³/s. Si están muy lejos, el modelo no representa bien este río.</li>}
          <li>Coincidencia con los niveles medidos del INA (si el caudal del modelo sube y baja junto con el nivel real; buena ≥ 0,7):{" "}
            {ok.map((s: any) => `${s.name} ${s.check.grade}${s.check.r != null ? ` (${num(s.check.r, 2)})` : ""}`).join(" · ")}.</li>
        </ul>
      </details>
    </div>
  );
}
