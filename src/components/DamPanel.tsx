import { useState } from "react";
import { api, Station } from "../api";
import { ago, cm, fDateTime, num, signed } from "../fmt";

const LABEL: Record<string, string> = {
  cota: "Cota del embalse", volumen: "Volumen almacenado", almacenamiento_pct: "Porcentaje de almacenamiento",
  caudal_entrante: "Caudal entrante", caudal_saliente: "Caudal saliente", generacion: "Generación hidroeléctrica",
};

export function DamSummary({ dam, stations }: { dam: any; stations: Station[] }) {
  const cota = dam?.variables?.cota;
  const below = stations.find((s) => s.key === "ameghino_abajo");
  const plumas = stations.find((s) => s.key === "las_plumas");
  return (
    <div className="card">
      <h3 style={{ margin: 0, fontSize: 13, letterSpacing: ".1em" }}>DIQUE FLORENTINO AMEGHINO</h3>
      <dl className="kv" style={{ gridTemplateColumns: "auto auto" }}>
        <dt>Cota</dt>
        <dd>{cota?.available ? <><b>{num(cota.last.value)} m</b> <span className="small muted">MANUAL · {cota.last.ts_local}</span></> : <span className="nodata">Sin datos públicos disponibles</span>}</dd>
        <dt>Cambio 24 h / 7 d</dt>
        <dd>{cota?.available ? `${cm(cota.changes["24h"])} / ${cm(cota.changes["7d"])}` : <span className="nodata">—</span>}</dd>
        <dt>Almacenamiento</dt>
        <dd>{dam?.variables?.almacenamiento_pct?.available ? `${num(dam.variables.almacenamiento_pct.last.value, 1)} % (MANUAL)` : <span className="nodata">Sin datos públicos disponibles</span>}</dd>
        <dt>Aporte del río</dt>
        <dd>{plumas?.level ? <>Las Plumas {num(plumas.level.value)} m, 24 h {cm(plumas.level.changes["24h"]?.delta_m)} <span className="small muted">(nivel; sin caudal)</span></> : <span className="nodata">sin datos</span>}</dd>
        <dt>Río aguas abajo</dt>
        <dd>{below?.level ? <>{num(below.level.value)} m, 24 h {cm(below.level.changes["24h"]?.delta_m)} <span className="small muted">(INA)</span></> : <span className="nodata">sin datos</span>}</dd>
      </dl>
    </div>
  );
}

export function DamPanel({ dam, stations, reload }: { dam: any; stations: Station[]; reload: () => void }) {
  const [form, setForm] = useState({ ts: new Date().toISOString().slice(0, 10), variable: "cota", value: "", source: "", source_url: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  if (!dam) return null;
  const below = stations.find((s) => s.key === "ameghino_abajo");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.addDam(form); setForm({ ...form, value: "" }); reload(); } catch (x) { setErr(String(x)); }
  };
  return (
    <div className="grid g2">
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Variable</th><th className="n">Valor</th><th className="n">24 h</th><th className="n">7 d</th><th className="n">30 d</th><th>Fecha / fuente</th></tr></thead>
          <tbody>
            <tr><td>Cota máxima normal</td><td className="n" colSpan={4}>{dam.cota_max_normal != null ? `${num(dam.cota_max_normal)} m (config.)` : <span className="nodata">Sin datos públicos disponibles</span>}</td><td className="small muted">sin fuente oficial</td></tr>
            <tr><td>Cota mínima operativa</td><td className="n" colSpan={4}>{dam.cota_min_operativa != null ? `${num(dam.cota_min_operativa)} m (config.)` : <span className="nodata">Sin datos públicos disponibles</span>}</td><td className="small muted">sin fuente oficial</td></tr>
            {Object.entries(dam.variables).map(([k, v]: [string, any]) => (
              <tr key={k}>
                <td>{LABEL[k]}</td>
                {v.available ? <>
                  <td className="n"><b>{num(v.last.value, k === "cota" ? 2 : 1)} {v.unit}</b></td>
                  {["24h", "7d", "30d"].map((w) => <td key={w} className="n">{v.changes[w] == null ? "—" : k === "cota" ? cm(v.changes[w]) : signed(v.changes[w], ` ${v.unit}`)}</td>)}
                  <td className="small">MANUAL · {v.last.ts_local} ({ago(v.last.ts)})<br />{v.last.source_url ? <a href={v.last.source_url} target="_blank" rel="noreferrer">{v.last.source} ↗</a> : v.last.source}
                    <button className="small" style={{ marginLeft: 6 }} onClick={async () => { try { await api.delDam(v.last.id); reload(); } catch (e) { alert(String(e)); } }}>borrar</button></td>
                </> : <td colSpan={5} className="nodata">{v.message}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="msg info" style={{ marginTop: 10 }}>{dam.public_source_note}</div>
        <h4 style={{ margin: "14px 0 4px", fontSize: 13 }}>Balance del embalse</h4>
        {dam.balance.available
          ? <div className="msg">ESTIMADO: entrada {num(dam.balance.q_in, 1)} m³/s − salida {num(dam.balance.q_out, 1)} m³/s → ΔS ≈ {signed(dam.balance.delta_storage_hm3_day, " hm³/día", 3)}<div className="small muted">{dam.balance.note}</div></div>
          : <div className="msg info">{dam.balance.note}</div>}
        {below?.level && (
          <div className="small" style={{ marginTop: 10 }}>
            <b>Río aguas abajo del dique (INA, medido):</b> {num(below.level.value)} m · 24 h {cm(below.level.changes["24h"]?.delta_m)} · 7 d {cm(below.level.changes["7d"]?.delta_m)} · {fDateTime(below.level.ts)} · <a href={below.source.url} target="_blank" rel="noreferrer">fuente ↗</a>
            <div className="muted">Es la escala del río debajo de la presa, no la cota del lago. Sus cambios reflejan cambios de erogación.</div>
          </div>
        )}
      </div>
      <div className="card">
        <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Cargar un dato oficial (manual)</h4>
        <form className="grid" style={{ gap: 8 }} onSubmit={submit}>
          <div className="row">
            <input type="date" value={form.ts} onChange={(e) => setForm({ ...form, ts: e.target.value })} required />
            <select value={form.variable} onChange={(e) => setForm({ ...form, variable: e.target.value })}>
              {Object.entries(LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input placeholder="valor" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required style={{ width: 100 }} />
          </div>
          <input placeholder="Fuente (obligatoria), p.ej. IPA Chubut – comunicado" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} required />
          <input placeholder="URL de la fuente (opcional)" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} />
          <input placeholder="Nota (opcional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="row"><button className="primary" type="submit">Guardar</button>{err && <span className="err small">{err}</span>}</div>
        </form>
        <div className="src" style={{ marginTop: 8 }}>Unidades: cota m · volumen hm³ · % · caudales m³/s · generación MW. Los datos manuales se muestran siempre como MANUAL con su fuente.</div>
      </div>
    </div>
  );
}
