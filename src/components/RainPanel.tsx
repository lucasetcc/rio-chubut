import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useState } from "react";
import { api, Station } from "../api";
import { ago, cssVar, fDate, fDateTime, isoDaysAgo, num, stationColor } from "../fmt";

const W = ["24h", "48h", "72h", "7d", "30d"];

export function RainPanel({ rain, stations }: { rain: any; stations: Station[] }) {
  const list: any[] = rain?.stations || [];
  const withData = list.filter((s) => s.last_ts);
  const [sel, setSel] = useState<string>("");
  const [days, setDays] = useState(60);
  const [bars, setBars] = useState<any[]>([]);
  const [level, setLevel] = useState<[number, number][]>([]);
  const [monthly, setMonthly] = useState<any[]>([]);
  useEffect(() => { if (!sel && withData.length) setSel([...withData].sort((a, b) => (b.last_ts > a.last_ts ? 1 : -1))[0].key); }, [withData.length]);
  const cur = list.find((s) => s.key === sel);
  const hydroKey = cur?.near_hydro;
  const hydroName = stations.find((s) => s.key === hydroKey)?.name;

  useEffect(() => {
    if (!sel) return;
    api.history(sel, isoDaysAgo(days), "daily", "rain").then((h) => setBars(h.data)).catch(() => setBars([]));
    api.rainMonthly(sel).then(setMonthly).catch(() => setMonthly([]));
    if (hydroKey) api.history(hydroKey, isoDaysAgo(days), "raw").then((h) => setLevel(h.data.filter((d: any) => d.quality === "VALID").map((d: any) => [new Date(d.ts).getTime(), d.value]))).catch(() => setLevel([]));
    else setLevel([]);
  }, [sel, days, hydroKey]);

  const option = useMemo(() => {
    const muted = cssVar("var(--muted)"), line = cssVar("var(--line)");
    const xmin = Date.now() - days * 864e5, xmax = Date.now();
    const ax = (gi: number) => ({ type: "time", gridIndex: gi, min: xmin, max: xmax, axisLabel: { color: muted, show: gi === 1, hideOverlap: true }, axisLine: { lineStyle: { color: line } }, splitLine: { show: false } });
    return {
      animation: false,
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [{ left: 52, right: 16, top: 34, height: 104 }, { left: 52, right: 16, top: 178, bottom: 60 }],
      xAxis: [ax(0), ax(1)],
      yAxis: [
        { gridIndex: 0, name: "Lluvia (mm/día)", nameTextStyle: { color: muted, align: "left" }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: line, opacity: 0.6 } } },
        { gridIndex: 1, name: hydroName ? `Nivel ${hydroName} (m)` : "Nivel (m)", nameTextStyle: { color: muted, align: "left" }, scale: true, axisLabel: { color: muted }, splitLine: { lineStyle: { color: line, opacity: 0.6 } } },
      ],
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1] }, { type: "slider", xAxisIndex: [0, 1], height: 20, bottom: 10 }],
      tooltip: { trigger: "axis", backgroundColor: cssVar("var(--panel)"), borderColor: line, textStyle: { color: cssVar("var(--text)") },
        formatter: (ps: any[]) => ps.map((p) => p.seriesIndex === 0
          ? `<b>${fDate(new Date(p.value[0]).toISOString())}</b><br/>${p.marker} Lluvia: <b>${num(p.value[1], 1)} mm</b> (${p.data.n} registros)`
          : `<b>${fDateTime(new Date(p.value[0]).toISOString())}</b><br/>${p.marker} Nivel: <b>${num(p.value[1])} m</b>`).join("<br/>") + `<br/><span style="opacity:.7">Fuente: INA</span>` },
      series: [
        { type: "bar", xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 10, itemStyle: { color: cssVar("var(--s1)"), borderRadius: [3, 3, 0, 0] },
          data: bars.map((b) => ({ value: [new Date(b.date + "T12:00:00-03:00").getTime(), b.mm], n: b.n })) },
        { type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, lineStyle: { width: 2, color: hydroKey ? stationColor(hydroKey) : muted }, itemStyle: { color: hydroKey ? stationColor(hydroKey) : muted }, data: level },
      ],
    };
  }, [bars, level, days, hydroName]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Estación</th>{W.map((w) => <th key={w} className="n">{w}</th>)}<th className="n">Mes en curso</th><th>Último dato</th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.key} style={{ cursor: "pointer" }} onClick={() => setSel(s.key)}>
                <td><b>{s.name}</b>{s.key === sel && <span className="small muted"> ← en gráfico</span>}</td>
                {W.map((w) => <td key={w} className="n">{s.windows[w].mm == null ? <span className="nodata">sin datos</span> : `${num(s.windows[w].mm, 1)} mm`}</td>)}
                <td className="n">{s.month_to_date?.mm == null ? <span className="nodata">sin datos</span> : `${num(s.month_to_date.mm, 1)} mm`}</td>
                <td className="small">{s.last_ts ? <>{fDateTime(s.last_ts)} <span className={s.stale ? "stale-note" : "muted"}>({ago(s.last_ts)})</span></> : <span className="nodata">sin datos</span>}
                  {s.source_url && <> · <a href={s.source_url} target="_blank" rel="noreferrer">INA ↗</a></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="src" style={{ marginTop: 8 }}>{rain?.note} Tecka y Cerro Cóndor no tienen pluviómetro en el INA.</div>
      </div>

      <div className="card">
        <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>¿La lluvia reciente está generando respuesta en el río?</h4>
        {(rain?.response || []).map((r: any) => (
          <div key={r.rain_station} className={`msg ${r.status === "respuesta" ? "" : "info"}`}>{r.message}</div>
        ))}
        <div className="disclaimer">Coincidencia temporal entre lluvia y subida del nivel en la estación asociada. No prueba causalidad: la crecida puede venir de lluvia o deshielo aguas arriba.</div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <b className="small">LLUVIA ↓ NIVEL</b>
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {list.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
          <div className="tabs">{[30, 60, 180, 365].map((d) => <button key={d} className={d === days ? "on" : ""} onClick={() => setDays(d)}>{d} d</button>)}</div>
          <span className="spacer" />
          <span className="small muted">{hydroName ? `Nivel: ${hydroName}` : "Sin estación de nivel asociada"}</span>
        </div>
        <ReactECharts option={option} notMerge style={{ height: 420 }} />
        {monthly.length > 0 && (
          <details>
            <summary>Acumulado mensual</summary>
            <div className="row small" style={{ marginTop: 6 }}>
              {monthly.slice(-18).map((m) => <span key={m.month} className="pill">{m.month}: <b>{num(m.mm, 1)} mm</b></span>)}
            </div>
            <div className="src">Meses parciales si la estación empezó a medir o tuvo cortes dentro del mes.</div>
          </details>
        )}
      </div>
    </div>
  );
}
