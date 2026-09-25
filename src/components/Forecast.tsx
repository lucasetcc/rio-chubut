import { fDateTime, num } from "../fmt";

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const dayLabel = (d: string, i: number) => (i === 0 ? "Hoy" : i === 1 ? "Mañana" : `${DAYS[new Date(d + "T12:00:00-03:00").getDay()]} ${d.slice(8, 10)}`);
const sum = (a: (number | null)[] | undefined, n: number) => (a ? a.slice(0, n).reduce((x: number, y) => x + (y || 0), 0) : null);

/** Resumen para el encabezado: mayor acumulado pronosticado a 3 días. */
export function forecastTop(fc: any) {
  const rows = (fc?.stations || []).filter((s: any) => s.daily).map((s: any) => ({ name: s.name, mm: sum(s.daily.precipitation_sum, 3) as number }));
  return rows.sort((a: any, b: any) => b.mm - a.mm)[0] || null;
}

export function ForecastPanel({ fc, err }: { fc: any; err: string | null }) {
  if (err) return <div className="card"><div className="msg warn">{err}</div></div>;
  if (!fc) return <div className="card muted">Cargando pronóstico…</div>;
  const rows = fc.stations.filter((s: any) => s.daily);
  if (!rows.length) return <div className="card nodata">Sin pronóstico disponible.</div>;
  const days: string[] = rows[0].daily.time;
  const top = forecastTop(fc);
  const cell = (mm: number | null) => {
    const a = mm == null ? 0 : Math.min(1, mm / 25);
    return { background: a > 0.02 ? `color-mix(in srgb, var(--s1) ${Math.round(10 + a * 60)}%, transparent)` : undefined };
  };
  return (
    <div className="card tablewrap">
      {top && <div className="small" style={{ marginBottom: 10 }}>
        {top.mm >= 1 ? <>Mayor lluvia pronosticada en los próximos 3 días: <b>{num(top.mm, 1)} mm en {top.name}</b>.</> : <>No se pronostica lluvia significativa en la cuenca en los próximos 3 días.</>}
      </div>}
      <table>
        <thead>
          <tr>
            <th>Lugar</th>
            {days.map((d, i) => <th key={d} className="n">{dayLabel(d, i)}</th>)}
            <th className="n">3 días</th><th className="n">{days.length} días</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s: any) => {
            const dd = s.daily;
            return (
              <tr key={s.key}>
                <td><b>{s.name}</b></td>
                {days.map((d, i) => {
                  const mm = dd.precipitation_sum?.[i], p = dd.precipitation_probability_max?.[i], sn = dd.snowfall_sum?.[i];
                  return (
                    <td key={d} className="n" style={cell(mm)} title={`Máx ${num(dd.temperature_2m_max?.[i], 0)}° · Mín ${num(dd.temperature_2m_min?.[i], 0)}°`}>
                      <b>{mm == null ? "—" : num(mm, 1)}</b>
                      <div className="muted" style={{ fontSize: 11 }}>{p != null ? `${p}%` : ""}{sn ? ` · ❄ ${num(sn, 1)} cm` : ""}</div>
                    </td>
                  );
                })}
                <td className="n"><b>{num(sum(dd.precipitation_sum, 3), 1)}</b></td>
                <td className="n">{num(sum(dd.precipitation_sum, days.length), 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="src" style={{ marginTop: 8 }}>
        Lluvia en mm por día (hora argentina) · % = probabilidad máxima de lluvia · ❄ = nieve pronosticada · pasá el mouse para ver temperaturas.
        Es un <b>pronóstico de modelos</b> de <a href={fc.source_url} target="_blank" rel="noreferrer">Open-Meteo</a>, no una medición ni un pronóstico oficial del SMN.
        Actualizado {fDateTime(fc.fetched_at)}.
      </div>
    </div>
  );
}
