import { lazy, Suspense, useEffect } from "react";
import { Station } from "../api";
import { ago, cm, fDateTimeArt, num, signed, stationColor } from "../fmt";
import { PctBar, StatusBadge, Tag } from "./StationCards";

const LevelChart = lazy(() => import("./Charts").then((m) => ({ default: m.LevelChart })));

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const rng = (r: [number, number]) => (r[0] === r[1] ? `~${r[0]} h` : `~${r[0]}–${r[1]} h`);

/** Todo lo de una sola estación, en un panel que se abre al tocar su tarjeta. */
export function StationDetail({ s, prop, fc, onClose }: { s: Station; prop: any; fc: any; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);

  const lv = s.level, ch = lv?.changes || {}, sb: any = s.stats_brief, fl: any = s.flood;
  const stale = s.status?.code === "stale";
  // tiempos de viaje: de dónde le llega y a dónde manda
  const all: any[] = [...(prop?.pairs || []), ...(prop?.direct || [])].filter((p) => p.ok);
  const chain: string[] = (prop?.chain || []).map((c: any) => c.key);
  const idx = chain.indexOf(s.key);
  const fromUp = idx > 0 ? all.find((p) => p.from === chain[idx - 1] && p.to === s.key) : null;
  const toDown = idx >= 0 && idx < chain.length - 1 ? all.find((p) => p.from === s.key && p.to === chain[idx + 1]) : null;
  const toEnd = idx >= 0 && idx < chain.length - 2 ? all.find((p) => p.from === s.key && p.to === chain[chain.length - 1]) : null;
  const incoming = (prop?.signals || []).flatMap((g: any) => g.downstream.filter((d: any) => d.to === s.key && d.hours_from_now[1] >= 0).map((d: any) => ({ ...d, from: g.name, peaked: g.peaked })));
  const own = (prop?.signals || []).find((g: any) => g.station === s.key);
  const f = fc?.stations?.find((x: any) => x.key === s.key)?.daily;
  const rain: any = s.rain;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Detalle ${s.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}><span className="swatch" style={{ background: stationColor(s.key), width: 11, height: 11, borderRadius: 3, display: "inline-block" }} />{s.name}</h2>
            <div className="small muted">{s.river}</div>
          </div>
          <span className="spacer" />
          <StatusBadge s={s.status} />
          <button className="close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="grid g2" style={{ gap: 12 }}>
          <div className="card">
            {lv ? <>
              <div className="big-detail">{num(lv.value)} <small>m</small></div>
              <div className="small muted">Lectura de escala · no es profundidad <Tag k="med" /></div>
              <div className="small" style={{ marginTop: 4 }}>{stale ? "Último dato" : "Dato"}: <b>{fDateTimeArt(lv.ts)}</b> · {ago(lv.ts)}</div>
              <div className="deltas" style={{ marginTop: 10, gridTemplateColumns: "repeat(4, 1fr)" }}>
                {(["1h", "6h", "24h", "7d"] as const).map((k) => <div key={k}><span>{k.replace("h", " h").replace("d", " días")}</span><b>{ch[k]?.delta_m == null ? "—" : cm(ch[k].delta_m)}</b></div>)}
              </div>
              {!stale && s.status?.trend?.cm_per_day != null && <div className="small muted" style={{ marginTop: 6 }}>Tendencia 24 h: <b>{signed(s.status.trend.cm_per_day, " cm/día")}</b> <Tag k="calc" /></div>}
              <PctBar s={s} />
            </> : <div className="nodata">Sin datos de nivel en los últimos 45 días.</div>}
          </div>

          <div className="card">
            <h4>Comparación con el pasado <Tag k="calc" /></h4>
            {sb ? <dl className="kv">
              <dt>Promedio 7 días</dt><dd>{sb.avg_7d == null ? "datos insuficientes" : `${num(sb.avg_7d)} m`}</dd>
              <dt>Promedio 30 días</dt><dd>{sb.avg_30d == null ? "datos insuficientes" : `${num(sb.avg_30d)} m`}</dd>
              <dt>Promedio 12 meses</dt><dd>{sb.avg_365d == null ? "datos insuficientes" : `${num(sb.avg_365d)} m`}</dd>
              {sb.clim?.ok && <><dt>Mediana de {sb.clim.month_name} ({sb.clim.years[0]}–{sb.clim.years[sb.clim.years.length - 1]})</dt><dd>{num(sb.clim.median)} m</dd>
                <dt>Rango normal de {sb.clim.month_name} (P25–P75)</dt><dd>{num(sb.clim.p25)}–{num(sb.clim.p75)} m</dd></>}
              <dt>Máximo registrado</dt><dd>{sb.hist?.max == null ? "—" : `${num(sb.hist.max)} m`}</dd>
              <dt>Mínimo registrado</dt><dd>{sb.hist?.min == null ? "—" : `${num(sb.hist.min)} m`}</dd>
              <dt>Registro desde</dt><dd>{sb.record_since ? fDateTimeArt(sb.record_since).slice(0, 10) : "—"}</dd>
            </dl> : <div className="nodata">Sin historia suficiente.</div>}
            {fl?.available && !fl.stale && <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Máximo 7 días</dt><dd>{num(fl.max_7d?.value)} m <span className="small muted">{fl.max_7d?.ts ? fDateTimeArt(fl.max_7d.ts).slice(0, 16) : ""}</span></dd>
              <dt>Máximo 30 días</dt><dd>{num(fl.max_30d?.value)} m <span className="small muted">{fl.max_30d?.ts ? fDateTimeArt(fl.max_30d.ts).slice(0, 16) : ""}</span></dd>
            </dl>}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <Suspense fallback={<div className="card muted small">Cargando gráfico…</div>}>
            <LevelChart stations={[s]} initial={s.key} single />
          </Suspense>
        </div>

        <div className="grid g2" style={{ gap: 12, marginTop: 12 }}>
          <div className="card">
            <h4>Crecidas y tiempos de viaje <Tag k="est" /></h4>
            {own && <div className="msg warn small">{own.messages[0]}</div>}
            {incoming.map((d: any, i: number) => (
              <div key={i} className="msg small">
                {d.peak_known ? <>El pico de <b>{d.from}</b> podría llegar acá entre <b>{fDateTimeArt(d.eta_from).slice(0, 16)}</b> y <b>{fDateTimeArt(d.eta_to).slice(0, 16)}</b>.</>
                  : <><b>{d.from}</b> sigue subiendo: el pico no llegaría acá antes de <b>{fDateTimeArt(d.eta_from).slice(0, 16)}</b>.</>}
                {d.confidence === "baja" && " (confianza baja)"}
              </div>
            ))}
            <dl className="kv">
              {fromUp && <><dt>Desde {fromUp.from_name} hasta acá</dt><dd>{rng(fromUp.lag_range_h)}</dd></>}
              {toDown && <><dt>De acá a {toDown.to_name}</dt><dd>{rng(toDown.lag_range_h)}</dd></>}
              {toEnd && <><dt>De acá a {toEnd.to_name}</dt><dd>{rng(toEnd.lag_range_h)}</dd></>}
            </dl>
            {!fromUp && !toDown && !own && !incoming.length && <div className="small muted">{idx < 0 ? "Esta estación no está en la línea principal del Río Chubut; no se calculan tiempos de viaje." : "Sin estimaciones para esta estación."}</div>}
            <div className="src">Estimación estadística con crecidas pasadas; no es un pronóstico oficial.</div>
          </div>

          <div className="card">
            <h4>Lluvia</h4>
            {rain ? <dl className="kv">
              {(["24h", "72h", "7d", "30d"] as const).map((k) => <span key={k} style={{ display: "contents" }}><dt>Medida {k.replace("h", " h").replace("d", " días")}</dt><dd>{rain.windows?.[k]?.mm == null ? <span className="nodata">sin datos</span> : `${num(rain.windows[k].mm, 1)} mm${rain.windows[k].partial ? " (parcial)" : ""}`}</dd></span>)}
            </dl> : <div className="small muted">Esta estación no tiene pluviómetro en el INA.</div>}
            {f && <>
              <div className="small" style={{ margin: "10px 0 4px" }}><b>Pronóstico</b> <span className="muted">(modelos Open-Meteo)</span></div>
              <div className="fc-strip">
                {f.time.map((d: string, i: number) => (
                  <div key={d}>
                    <span>{i === 0 ? "Hoy" : i === 1 ? "Mañ." : `${DAYS[new Date(d + "T12:00:00-03:00").getDay()]} ${d.slice(8, 10)}`}</span>
                    <b>{f.precipitation_sum[i] == null ? "s/d" : `${num(f.precipitation_sum[i], 1)}`}</b>
                    <small>{f.snowfall_sum?.[i] > 0 ? "❄ " : ""}{f.precipitation_probability_max?.[i] != null ? `${f.precipitation_probability_max[i]}%` : ""}</small>
                  </div>
                ))}
              </div>
              <div className="src">mm por día · % = probabilidad de lluvia · ❄ nieve</div>
            </>}
          </div>
        </div>

        <div className="small muted" style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>Umbral oficial: {s.status?.manual_threshold_m != null ? `${num(s.status.manual_threshold_m)} m (cargado con fuente)` : "no disponible"}</span>
          <a href={s.source.url} target="_blank" rel="noreferrer">Ver serie en el INA ↗</a>
          {s.notes && <span>{s.notes}</span>}
        </div>
      </div>
    </div>
  );
}
