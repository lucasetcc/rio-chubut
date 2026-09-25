import { useEffect, useState } from "react";
import { api, Station } from "../api";
import { ago, fDateTime, isoDaysAgo } from "../fmt";

export function AlertsPanel({ alerts, reload }: { alerts: any[]; reload: () => void }) {
  const active = alerts.filter((a) => !a.cleared_at);
  const past = alerts.filter((a) => a.cleared_at).slice(0, 20);
  return (
    <div className="card">
      {active.length === 0 ? <div className="msg info">No hay alertas activas.</div> : active.map((a) => (
        <div key={a.id} className={`msg ${a.type === "rise" || a.type === "propagation" ? "warn" : ""}`} style={{ opacity: a.acknowledged ? 0.6 : 1 }}>
          <div className="row">
            <b>{a.message}</b><span className="spacer" />
            {!a.acknowledged && <button className="small" onClick={async () => { await api.ack(a.id); reload(); }}>Visto</button>}
          </div>
          <div className="small muted">Dato: {a.data_local || "—"} · regla: {a.rule_description}</div>
        </div>
      ))}
      {past.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary>Historial ({past.length})</summary>
          <table style={{ marginTop: 6 }}><tbody>
            {past.map((a) => <tr key={a.id}><td className="small">{a.triggered_local} → {a.cleared_local}</td><td className="small">{a.message}</td></tr>)}
          </tbody></table>
        </details>
      )}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { rise: "Subida", above_avg: "Sobre promedio", trend: "Tendencia", propagation: "Señal aguas arriba", rain: "Lluvia", stale: "Sin actualizar" };
const PARAM_LABEL: Record<string, string> = { cm: "cm", hours: "horas", days: "días", mm: "mm", direction: "" };

function RuleRow({ rule, types, stations, onSaved }: { rule: any; types: any; stations: Station[]; onSaved: () => void }) {
  const [r, setR] = useState(rule);
  const [msg, setMsg] = useState<string | null>(null);
  const paramKeys = Object.keys(types[r.type]?.params || {});
  const save = async () => {
    try { await api.saveRule(r); setMsg("guardado"); onSaved(); } catch (e) { setMsg(String(e)); }
  };
  return (
    <tr>
      <td><input type="checkbox" checked={!!r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} /></td>
      <td>
        <select value={r.type} onChange={(e) => setR({ ...r, type: e.target.value, params: {} })}>
          {Object.keys(types).map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
        </select>
        <div className="small muted">{types[r.type]?.help}</div>
      </td>
      <td>
        <select value={r.station_key || ""} onChange={(e) => setR({ ...r, station_key: e.target.value || null })}>
          <option value="">(todas)</option>
          {stations.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
      </td>
      <td>
        <div className="row">
          {paramKeys.map((k) => (
            <label key={k} className="small">{PARAM_LABEL[k] ?? k}{" "}
              {k === "direction"
                ? <select value={r.params[k] || "SUBIENDO"} onChange={(e) => setR({ ...r, params: { ...r.params, [k]: e.target.value } })}><option>SUBIENDO</option><option>BAJANDO</option></select>
                : <input style={{ width: 70 }} value={r.params[k] ?? ""} onChange={(e) => setR({ ...r, params: { ...r.params, [k]: e.target.value === "" ? "" : Number(e.target.value.replace(",", ".")) } })} />}
            </label>
          ))}
        </div>
      </td>
      <td><input value={r.description || ""} onChange={(e) => setR({ ...r, description: e.target.value })} style={{ width: "100%", minWidth: 180 }} /></td>
      <td className="row">
        <button className="small primary" onClick={save}>Guardar</button>
        {r.id && <button className="small" onClick={async () => { try { await api.delRule(r.id); onSaved(); } catch (e) { setMsg(String(e)); } }}>Borrar</button>}
        {msg && <span className="small muted">{msg}</span>}
      </td>
    </tr>
  );
}

export function ConfigPanel({ stations, reloadAll }: { stations: Station[]; reloadAll: () => void }) {
  const [rules, setRules] = useState<any>(null);
  const [th, setTh] = useState<any>({});
  const [disc, setDisc] = useState<any>(null);
  const load = () => {
    api.rules().then(setRules);
    api.thresholds().then(setTh);
    api.discovery().then(setDisc);
  };
  useEffect(load, []);
  const hydro = stations.filter((s) => s.has_level);
  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="card tablewrap">
        <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Reglas de alerta</h4>
        {rules && (
          <table>
            <thead><tr><th>Activa</th><th>Tipo</th><th>Estación</th><th>Parámetros</th><th>Descripción</th><th></th></tr></thead>
            <tbody>
              {rules.rules.map((r: any) => <RuleRow key={r.id} rule={r} types={rules.types} stations={stations} onSaved={() => { load(); reloadAll(); }} />)}
              <RuleRow key={`new-${rules.rules.length}`} rule={{ type: "rise", station_key: null, params: { cm: 10, hours: 6 }, enabled: 1, description: "" }} types={rules.types} stations={stations} onSaved={() => { load(); reloadAll(); }} />
            </tbody>
          </table>
        )}
        <div className="src">Los valores por defecto son ejemplos editables, no umbrales oficiales. Guardar cambios pide la clave de administrador (ADMIN_KEY) una vez por dispositivo.</div>
      </div>

      <div className="card tablewrap">
        <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Umbral manual de “crecida importante” (🔴)</h4>
        <div className="small muted" style={{ marginBottom: 8 }}>
          Sin umbral manual, 🔴 se activa sólo si el nivel supera el P90 de los promedios diarios históricos (con ≥365 días de historia) y está subiendo.
          Si tenés un umbral oficial (p.ej. de Defensa Civil o el IPA), cargalo acá.
        </div>
        <table><tbody>
          {hydro.map((s) => (
            <tr key={s.key}>
              <td>{s.name}</td>
              <td className="small muted">P90 hist.: {s.stats_brief?.p90_hist != null && s.stats_brief.history_days >= 365 ? `${s.stats_brief.p90_hist.toFixed(2)} m` : "historia insuficiente"}</td>
              <td>
                <form key={`${s.key}:${th[s.key]?.crecida_m ?? ""}`} className="inline" onSubmit={async (e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem("v") as HTMLInputElement).value; try { setTh(await api.setThreshold(s.key, v)); reloadAll(); } catch (x) { alert(String(x)); } }}>
                  <input name="v" defaultValue={th[s.key]?.crecida_m ?? ""} placeholder="m (vacío = sin umbral)" style={{ width: 150 }} />
                  <button className="small">Guardar</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>

      <div className="card tablewrap">
        <div className="row" style={{ marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>Estaciones detectadas automáticamente</h4>
          <span className="spacer" />
          <span className="small muted">Última búsqueda: {disc?.last_run ? fDateTime(disc.last_run) : "nunca"}</span>
          <button className="small" onClick={async () => { try { await api.runDiscovery(); load(); } catch (e) { alert(String(e)); } }}>Buscar ahora</button>
        </div>
        <div className="small muted" style={{ marginBottom: 8 }}>{disc?.note}</div>
        {disc?.candidates?.length ? (
          <table>
            <thead><tr><th>Estación INA</th><th>Serie</th><th>Variable</th><th>Datos</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {disc.candidates.map((c: any) => (
                <tr key={c.series_id}>
                  <td>{c.station_name} <span className="small muted">(#{c.ina_station_id}, {c.lat?.toFixed(2)}, {c.lon?.toFixed(2)})</span></td>
                  <td><a href={c.source_url} target="_blank" rel="noreferrer">{c.series_id} ↗</a></td>
                  <td>{c.var_code} – {c.var_name} ({c.unit})</td>
                  <td className="small">{c.timestart?.slice(0, 10)} → {c.timeend?.slice(0, 10)} · {c.count ?? "?"} · {c.availability}</td>
                  <td>{c.status}</td>
                  <td className="row">
                    {c.status === "new" && <>
                      <button className="small primary" onClick={async () => { try { await api.enableDiscovered(c.series_id); load(); reloadAll(); } catch (e) { alert(String(e)); } }}>Agregar</button>
                      <button className="small" onClick={async () => { try { await api.ignoreDiscovered(c.series_id); load(); } catch (e) { alert(String(e)); } }}>Ignorar</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="nodata">Sin candidatos nuevos.</div>}
      </div>
    </div>
  );
}

export function ExportPanel({ stations }: { stations: Station[] }) {
  const [k, setK] = useState(stations.find((s) => s.main)?.key || stations[0]?.key || "");
  const st = stations.find((s) => s.key === k);
  const [variable, setVariable] = useState("level");
  const [from, setFrom] = useState(isoDaysAgo(30).slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (st && !st.has_level && variable !== "rain") setVariable("rain"); }, [k]);
  const go = async (f: string) => {
    setMsg("generando…");
    try { const n = await api.exportData(k, variable, from, to, f); setMsg(`${n} registros`); } catch (e) { setMsg(String(e)); }
  };
  return (
    <div className="card">
      <div className="row">
        <select value={k} onChange={(e) => setK(e.target.value)}>{stations.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select>
        <select value={variable} onChange={(e) => setVariable(e.target.value)}>
          {st?.has_level && <option value="level">Nivel (telemétrico)</option>}
          {st?.series.some((x) => x.role === "level_hist") && <option value="level_hist">Nivel medio diario BDHI</option>}
          {st?.has_rain && <option value="rain">Lluvia</option>}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> a
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button onClick={() => go("csv")}>CSV</button>
        <button onClick={() => go("xlsx")}>Excel</button>
        <button onClick={() => go("json")}>JSON</button>
        {msg && <span className="small muted">{msg}</span>}
      </div>
      <div className="src" style={{ marginTop: 6 }}>Incluye timestamp UTC y local, valor, unidad, calidad (VALID/SUSPECT/MISSING) y fuente.</div>
    </div>
  );
}

export function SystemPanel({ status }: { status: any }) {
  if (!status) return null;
  return (
    <div className="card tablewrap">
      <div className="small" style={{ marginBottom: 8 }}>
        Datos del INA vía proxy con caché de 10 min (compartida por todos los visitantes) · esta página los cargó {status.collector.last_cycle?.at ? `${fDateTime(status.collector.last_cycle.at)} (${ago(status.collector.last_cycle.at)})` : "—"} · se actualiza sola cada 5 min
        {status.collector.last_cycle_error && <div className="err">{status.collector.last_cycle_error}</div>}
      </div>
      <table>
        <thead><tr><th>Serie INA</th><th>Estación</th><th>Rol</th><th>Verificación</th><th>Último dato</th><th>Última consulta</th></tr></thead>
        <tbody>
          {status.series.map((s: any) => (
            <tr key={s.id}>
              <td><a href={s.source_url} target="_blank" rel="noreferrer">{s.id} ↗</a></td>
              <td>{s.station_key}</td><td>{s.role}</td>
              <td className={s.verify_status === "ok" ? "" : "err"}>{s.verify_status}{s.verify_detail ? ` – ${s.verify_detail}` : ""}</td>
              <td className={s.stale ? "stale-note" : ""}>{s.last_obs_local || "—"}{s.age_hours != null && ` (${ago(s.last_obs_ts)})`}</td>
              <td className="small">{s.last_fetch_at ? fDateTime(s.last_fetch_at) : "—"} {s.last_fetch_status === "error" && <span className="err">{s.last_error}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
