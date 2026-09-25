import { useState } from "react";
import { api, Station } from "../api";
import { cm, fDateTime, num, signed } from "../fmt";

const LABEL: Record<string, string> = {
  cota: "Cota del embalse", volumen: "Volumen almacenado", almacenamiento_pct: "Porcentaje de almacenamiento",
  caudal_entrante: "Caudal entrante", caudal_saliente: "Caudal saliente (erogado)", generacion: "Generación hidroeléctrica",
};
const WHY_ND: Record<string, string> = {
  volumen: "N/D — no publicado (no hay curva cota-volumen pública)",
  almacenamiento_pct: "N/D — requiere el volumen; no se calcula con cota/cota máx.",
  caudal_entrante: "N/D — no publicado",
};
const ageTxt = (d: number) => (d < 1 ? "hoy" : d < 2 ? "hace 1 día" : `hace ${Math.round(d)} días`);
const metres = (m: number | null | undefined) => (m == null ? "—" : `${m > 0 ? "+" : m < 0 ? "−" : "±"}${Math.abs(m).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`);

function SourceLink({ r }: { r: any }) {
  return r.source_url || r.url ? <a href={r.source_url || r.url} target="_blank" rel="noreferrer">{r.source} ↗</a> : <>{r.source}</>;
}

export function DamSummary({ dam, stations }: { dam: any; stations: Station[] }) {
  const cota = dam?.variables?.cota;
  const below = stations.find((s) => s.key === "ameghino_abajo");
  const plumas = stations.find((s) => s.key === "las_plumas");
  const st = dam?.status;
  return (
    <div className="card">
      <h4 style={{ letterSpacing: ".08em", textTransform: "uppercase", fontSize: 12 }}>Dique Florentino Ameghino</h4>
      <dl className="kv" style={{ gridTemplateColumns: "auto auto" }}>
        <dt>Cota</dt>
        <dd>{cota?.available ? <><b>{num(cota.last.value)} m</b> <span className="small muted">{cota.last.ts_local} · {ageTxt(cota.age_days)}</span></> : <span className="nodata">Sin datos públicos</span>}</dd>
        {st && <><dt>vs máxima normal (166 m)</dt><dd>{metres(st.vs_max)}</dd>
          <dt>vs límite de generación</dt><dd>{metres(st.vs_gen)}</dd></>}
        <dt>Salida</dt>
        <dd>{dam?.variables?.caudal_saliente?.available ? <>{num(dam.variables.caudal_saliente.last.value, 0)} m³/s <span className="small muted">{dam.variables.caudal_saliente.last.ts_local}</span></> : <span className="nodata">N/D</span>}</dd>
        <dt>Aporte del río</dt>
        <dd>{plumas?.level ? <>Las Plumas 24 h {cm(plumas.level.changes["24h"]?.delta_m)} <span className="small muted">(nivel, INA)</span></> : <span className="nodata">sin datos</span>}</dd>
        <dt>Río aguas abajo</dt>
        <dd>{below?.level ? <>24 h {cm(below.level.changes["24h"]?.delta_m)} <span className="small muted">(INA)</span></> : <span className="nodata">sin datos</span>}</dd>
      </dl>
      {cota?.available && cota.age_days > 14 && <div className="stale-note" style={{ marginTop: 8 }}>Último dato publicado de cota: {ageTxt(cota.age_days)}. No hay publicación oficial periódica.</div>}
    </div>
  );
}

export function DamPanel({ dam, stations, reload }: { dam: any; stations: Station[]; reload: () => void }) {
  const [form, setForm] = useState({ ts: new Date().toISOString().slice(0, 10), variable: "cota", value: "", source: "", source_url: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  if (!dam) return null;
  const below = stations.find((s) => s.key === "ameghino_abajo");
  const st = dam.status;
  const V = dam.variables;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api.addDam(form); setForm({ ...form, value: "" }); reload(); } catch (x) { setErr(String(x)); }
  };
  const refRow = (key: string) => dam.references.find((r: any) => r.key === key);
  const fmtChange = (k: string, v: any, w: string) => (v.changes[w] == null ? <span className="nodata">N/D</span> : k === "cota" ? metres(v.changes[w]) : signed(v.changes[w], ` ${v.unit}`, 0));

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* estado actual */}
      <div className="kpis">
        <div className="kpi"><div className="k">Cota del embalse</div>
          <div className="v">{st ? num(st.cota) : "N/D"}<small> m</small></div>
          <div className="d">{st ? <>{V.cota.last.ts_local} · {ageTxt(st.age_days)} · {V.cota.last.quality}</> : "no publicado"}</div></div>
        <div className="kpi"><div className="k">vs cota máxima normal</div>
          <div className="v" style={{ color: "var(--fall)" }}>{st ? metres(st.vs_max) : "—"}</div>
          <div className="d">vertedero {num(dam.cota_max_normal)} m</div></div>
        <div className="kpi"><div className="k">vs límite de generación</div>
          <div className="v">{st ? metres(st.vs_gen) : "—"}</div>
          <div className="d">informado: {refRow("cota_min_generacion")?.display}</div></div>
        <div className="kpi"><div className="k">vs mínimo histórico</div>
          <div className="v">{st ? metres(st.vs_min_hist) : "—"}</div>
          <div className="d">{num(refRow("cota_min_historica")?.value)} m (1988)</div></div>
      </div>
      {st && (st.age_days > 14 || st.trend_note) && (
        <div className="msg warn">
          {st.trend_note && <>Última tendencia informada ({V.cota.last.ts_local}): <b>{st.trend_note}</b>. </>}
          El último dato publicado de cota es de <b>{ageTxt(st.age_days)}</b>: no refleja necesariamente el nivel actual. No existe un parte oficial periódico.
        </div>
      )}

      <div className="grid g2">
        {/* tabla principal */}
        <div className="card tablewrap">
          <h4>Tabla principal</h4>
          <table>
            <thead><tr><th>Variable</th><th className="n">Valor</th><th className="n">24 h</th><th className="n">7 d</th><th className="n">30 d</th><th>Fecha / fuente</th></tr></thead>
            <tbody>
              {[["cota_vertedero", "Cota máxima normal"], ["cota_min_operativa", "Cota mínima operativa"]].map(([k, l]) => {
                const r = refRow(k);
                return (
                  <tr key={k}>
                    <td>{l}</td>
                    <td className="n">{r?.value != null ? <b>{num(r.value)} m</b> : <span className="nodata">N/D</span>}</td>
                    <td className="n muted">N/A</td><td className="n muted">N/A</td><td className="n muted">N/A</td>
                    <td className="small">{r?.value != null ? <><SourceLink r={r} />{r.date ? ` · ${r.date.split("-").reverse().join("/")}` : ""}</> : <span className="muted">{r?.note || "no publicado"}</span>}</td>
                  </tr>
                );
              })}
              {Object.entries(V).map(([k, v]: [string, any]) => (
                <tr key={k}>
                  <td>{LABEL[k]}</td>
                  {v.available ? <>
                    <td className="n"><b>{num(v.last.value, k === "cota" ? 2 : 0)} {v.unit}</b></td>
                    {["24h", "7d", "30d"].map((w) => <td key={w} className="n">{fmtChange(k, v, w)}</td>)}
                    <td className="small">{v.last.ts_local} · <SourceLink r={v.last} />{v.last.note ? <div className="muted">{v.last.note}</div> : null}
                      {v.last.quality === "MANUAL" && <button className="small" style={{ marginLeft: 6 }} onClick={async () => { try { await api.delDam(v.last.id); reload(); } catch (e) { alert(String(e)); } }}>borrar</button>}</td>
                  </> : <td colSpan={5} className="nodata">{WHY_ND[k] || "N/D — no publicado"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="src" style={{ marginTop: 8 }}>
            Los cambios de 24 h / 7 d / 30 d solo se calculan si hay un dato publicado en esa fecha (± tolerancia); con publicaciones esporádicas quedan en N/D.
            El porcentaje de almacenamiento no se calcula como cota/cota máxima porque la relación cota-volumen no es lineal y no está publicada.
          </div>
          <div className="msg info small" style={{ marginTop: 10 }}>{dam.public_source_note}</div>
          {below?.level && (
            <div className="small" style={{ marginTop: 10 }}>
              <b>Río aguas abajo del dique (INA, medido cada hora/4 h):</b> escala {num(below.level.value)} m · 24 h {cm(below.level.changes["24h"]?.delta_m)} · 7 d {cm(below.level.changes["7d"]?.delta_m)} · {fDateTime(below.level.ts)} · <a href={below.source.url} target="_blank" rel="noreferrer">fuente ↗</a>
              <div className="muted">No es la cota del lago: sus cambios reflejan cambios de erogación.</div>
            </div>
          )}
        </div>

        {/* referencias técnicas */}
        <div className="card tablewrap">
          <h4>Datos técnicos de referencia</h4>
          <table>
            <tbody>
              {dam.references.map((r: any) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="n"><b>{r.value == null ? <span className="nodata">N/D</span> : r.display || `${num(r.value, r.value % 1 ? 2 : 0)} ${r.unit}`}</b></td>
                  <td className="small">{r.value == null ? <span className="muted">{r.note}</span> : <><SourceLink r={r} />{r.note ? <div className="muted">{r.note}</div> : null}</>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid g2">
        {/* cronología */}
        <div className="card tablewrap">
          <h4>Cronología publicada (oct/2025 → hoy)</h4>
          <table>
            <thead><tr><th>Fecha</th><th>Variable</th><th className="n">Valor</th><th>Fuente</th></tr></thead>
            <tbody>
              {dam.chronology.map((r: any) => (
                <tr key={r.id}>
                  <td className="small">{r.ts_local}</td>
                  <td className="small">{LABEL[r.variable] || r.variable}</td>
                  <td className="n"><b>{num(r.value, r.variable === "cota" ? 2 : 0)} {r.unit}</b>{r.approx && <span className="muted small"> aprox.</span>}</td>
                  <td className="small"><SourceLink r={r} /> <span className="muted">· {r.quality}</span>{r.note ? <div className="muted">{r.note}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* carga manual */}
        <div className="card">
          <h4>Cargar un dato oficial nuevo</h4>
          <form className="grid" style={{ gap: 8 }} onSubmit={submit}>
            <div className="row">
              <input type="date" value={form.ts} onChange={(e) => setForm({ ...form, ts: e.target.value })} required />
              <select value={form.variable} onChange={(e) => setForm({ ...form, variable: e.target.value })}>
                {Object.entries(LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input placeholder="valor" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required style={{ width: 100 }} />
            </div>
            <input placeholder="Fuente (obligatoria), p.ej. IPA vía El Chubut" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} required />
            <input placeholder="URL de la fuente (opcional)" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} />
            <input placeholder="Nota (opcional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <div className="row"><button className="primary" type="submit">Guardar</button>{err && <span className="err small">{err}</span>}</div>
          </form>
          <div className="src" style={{ marginTop: 8 }}>Unidades: cota m · volumen hm³ · % · caudales m³/s · generación MW. Queda marcado como MANUAL con su fuente y se suma a la cronología.</div>
        </div>
      </div>
    </div>
  );
}
