import { useCallback, useEffect, useState } from "react";
import { api, Station } from "./api";
import { AlertsPanel, ConfigPanel, ExportPanel, SystemPanel } from "./components/AlertsConfig";
import { LevelChart } from "./components/Charts";
import { DamPanel, DamSummary } from "./components/DamPanel";
import { MapPanel } from "./components/MapPanel";
import { FloodPanel, PropagationPanel } from "./components/Propagation";
import { RainPanel } from "./components/RainPanel";
import { StationCard, StationTable } from "./components/StationCards";
import { StatsPanel } from "./components/StatsPanel";
import { ago, fDateTime } from "./fmt";

const NAV = [
  ["estado", "Estado"], ["graficos", "📈 Evolución"], ["comparacion", "Promedios"], ["lluvia", "🌧️ Lluvia"],
  ["propagacion", "🌊 Propagación"], ["mapa", "🗺️ Mapa"], ["dique", "Dique"], ["alertas", "⚠️ Alertas"], ["datos", "Datos y config."],
];

export default function App() {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [rain, setRain] = useState<any>(null);
  const [prop, setProp] = useState<any>(null);
  const [floods, setFloods] = useState<any[]>([]);
  const [dam, setDam] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [statsKey, setStatsKey] = useState("cerro_condor");
  const [collectMsg, setCollectMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [st, ss] = await Promise.all([api.stations(), api.status()]);
      setStations(st); setStatus(ss); setErr(null);
      api.rainfall().then(setRain).catch(() => {});
      api.floods().then(setFloods).catch(() => {});
      api.dam().then(setDam).catch(() => {});
      api.alerts().then(setAlerts).catch(() => {});
      api.propagation().then(setProp).catch(() => {});
    } catch (e) {
      setErr(`No se pudo contactar al backend: ${e}`);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(async () => { await api.collect().catch(() => {}); load(); }, 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!stations) {
    return <div className="wrap" style={{ paddingTop: 40 }}>{err ? <div className="err">{err}</div> : "Cargando datos del INA…"}</div>;
  }

  const main = stations.filter((s) => s.main && s.has_level).sort((a, b) => (a.chain_order || 0) - (b.chain_order || 0));
  const others = stations.filter((s) => !s.main);
  const activeAlerts = alerts.filter((a) => !a.cleared_at);
  const empty = !status?.last_data_ts;

  const collect = async () => {
    setCollectMsg(null);
    setCollectMsg("actualizando…"); try { const r = await api.collect(); setCollectMsg(r.status); load(); } catch (e) { setCollectMsg(String(e)); }
  };

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="brand">RÍO CHUBUT — MONITOR HIDROLÓGICO<small>Cuenca aportante al Dique Florentino Ameghino</small></div>
          <nav className="sections">{NAV.map(([id, l]) => <a key={id} href={`#${id}`}>{l}{id === "alertas" && activeAlerts.length ? ` (${activeAlerts.length})` : ""}</a>)}</nav>
          <span className="pill"><span className="real">● {status?.mode || "REAL DATA"}</span></span>
        </div>
      </header>

      <main className="wrap">
        <section id="estado">
          <div className="hero card">
            <div>
              <div className="sys">{status?.overall?.emoji} Sistema general: {status?.overall?.label}</div>
              <div className="small">
                Último dato recibido: <b>{status?.last_data_local || "—"}</b>{status?.last_data_ts && <span className="muted"> ({ago(status.last_data_ts)})</span>}
                {" · "}Datos cargados: {status?.collector?.last_cycle?.at ? `${fDateTime(status.collector.last_cycle.at)}` : "—"}
                
              </div>
            </div>
            <span className="spacer" />
            <button onClick={collect}>Actualizar ahora</button>
            {collectMsg && <span className="small muted">{collectMsg}</span>}
          </div>
          {err && <div className="msg crit">{err}</div>}
          {empty && <div className="msg warn">No llegaron datos del INA. Puede estar caído o lento: la página reintenta sola cada 5 minutos.</div>}
          {activeAlerts.slice(0, 3).map((a) => <div key={a.id} className="msg warn">⚠️ {a.message}</div>)}

          <h2 style={{ marginTop: 18, fontSize: 13, letterSpacing: ".12em", color: "var(--text-2)" }}>ESTADO ACTUAL · aguas arriba → aguas abajo</h2>
          <div className="chain">{main.map((s) => <StationCard key={s.key} s={s} />)}</div>
          <div className="grid g2" style={{ marginTop: 12 }}>
            <DamSummary dam={dam} stations={stations} />
            <FloodPanel floods={floods} />
          </div>
        </section>

        <section id="tabla">
          <h2>Todas las estaciones <span className="hint">incluye cabecera, afluentes, pluviómetros y el río aguas abajo del dique</span></h2>
          <StationTable stations={[...main, ...others]} />
        </section>

        <section id="graficos">
          <h2>📈 Evolución <span className="hint">zoom con rueda/arrastre · superponé estaciones para ver la crecida viajar aguas abajo</span></h2>
          <LevelChart stations={stations} initial={main[0]?.key || "cerro_condor"} />
        </section>

        <section id="comparacion">
          <h2>Comparación con el pasado</h2>
          <StatsPanel stations={stations} selected={statsKey} onSelect={setStatsKey} />
        </section>

        <section id="lluvia">
          <h2>🌧️ Precipitaciones</h2>
          <RainPanel rain={rain} stations={stations} />
        </section>

        <section id="propagacion">
          <h2>🌊 Propagación de la crecida <span className="hint">estimación estadística, no pronóstico oficial</span></h2>
          <PropagationPanel prop={prop} />
        </section>

        <section id="mapa">
          <h2>🗺️ Mapa de la cuenca</h2>
          <MapPanel stations={stations} rain={rain} dam={dam} />
        </section>

        <section id="dique">
          <h2>Dique Florentino Ameghino</h2>
          <DamPanel dam={dam} stations={stations} reload={load} />
        </section>

        <section id="alertas">
          <h2>⚠️ Alertas</h2>
          <AlertsPanel alerts={alerts} reload={load} />
        </section>

        <section id="datos">
          <h2>Exportar datos</h2>
          <ExportPanel stations={stations} />
          <h2 style={{ marginTop: 20 }}>Configuración</h2>
          <ConfigPanel stations={stations} reloadAll={load} />
          <h2 style={{ marginTop: 20 }}>Estado de las fuentes</h2>
          <SystemPanel status={status} />
          <p className="src">
            Fuente de datos: Instituto Nacional del Agua (INA), <a href="https://alerta.ina.gob.ar/" target="_blank" rel="noreferrer">alerta.ina.gob.ar</a> — Red Hidrológica Nacional.
            Horarios en hora argentina. Esta aplicación no es un sistema oficial de alerta.
          </p>
        </section>
      </main>
    </>
  );
}

