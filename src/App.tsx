import { useCallback, useEffect, useState } from "react";
import { api, Station } from "./api";
import { AlertsPanel, ConfigPanel, ExportPanel, SystemPanel } from "./components/AlertsConfig";
import { LevelChart } from "./components/Charts";
import { DamPanel, DamSummary } from "./components/DamPanel";
import { MapPanel } from "./components/MapPanel";
import { ForecastPanel, forecastTop } from "./components/Forecast";
import { Headline, Kpis, RiverProfile } from "./components/Overview";
import { FloodPanel, PropagationPanel } from "./components/Propagation";
import { RainPanel } from "./components/RainPanel";
import { StationCard, StationTable } from "./components/StationCards";
import { StatsPanel } from "./components/StatsPanel";
import { S } from "./data/engine";
import { ago, fDateTime } from "./fmt";

const NAV = [
  ["estado", "Estado"], ["graficos", "Evolución"], ["comparacion", "Promedios"], ["lluvia", "Lluvia"], ["pronostico", "Pronóstico"],
  ["propagacion", "Propagación"], ["mapa", "Mapa"], ["dique", "Dique"], ["alertas", "Alertas"], ["datos", "Datos"],
];

const Logo = () => (
  <span className="logo" aria-hidden>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
      <path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" />
      <path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" opacity=".65" />
    </svg>
  </span>
);

function useTheme() {
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem("theme") || "dark"; } catch { return "dark"; } });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch { /* */ }
  }, [theme]);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")] as const;
}

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
  const [fc, setFc] = useState<any>(null);
  const [fcErr, setFcErr] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [theme, toggleTheme] = useTheme();
  const [, force] = useState(0);

  const load = useCallback(async () => {
    try {
      const [st, ss] = await Promise.all([api.stations(), api.status()]);
      setStations(st); setStatus(ss); setErr(null);
      api.rainfall().then(setRain).catch(() => {});
      api.floods().then(setFloods).catch(() => {});
      api.dam().then(setDam).catch(() => {});
      api.alerts().then(setAlerts).catch(() => {});
      api.propagation().then(setProp).catch(() => {});
      api.forecast().then((f) => { setFc(f); setFcErr(null); }).catch((e) => setFcErr(String(e.message || e)));
    } catch (e) {
      setErr(`No se pudieron cargar los datos: ${e}`);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(async () => { await api.collect().catch(() => {}); load(); }, 5 * 60_000);
    const p = setInterval(() => setProgress({ ...S.progress }), 300);
    return () => { clearInterval(t); clearInterval(p); };
  }, [load]);

  // los gráficos leen colores del tema: redibujar al cambiarlo
  useEffect(() => { force((x) => x + 1); }, [theme]);

  if (!stations) {
    const pct = progress.total ? Math.round((100 * progress.done) / progress.total) : 5;
    return (
      <div className="loading">
        <div>
          <div className="brand" style={{ justifyContent: "center" }}><Logo /><div style={{ textAlign: "left" }}><b>Río Chubut — Monitor Hidrológico</b><small>Cuenca aportante al Dique F. Ameghino</small></div></div>
          {err ? <div className="err" style={{ marginTop: 16 }}>{err}</div> : <>
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            <div className="small muted">Descargando series del INA… {progress.total ? `${progress.done}/${progress.total}` : ""}</div>
          </>}
        </div>
      </div>
    );
  }

  const main = stations.filter((s) => s.main && s.has_level).sort((a, b) => (a.chain_order || 0) - (b.chain_order || 0));
  const others = stations.filter((s) => !s.main);
  const activeAlerts = alerts.filter((a) => !a.cleared_at);
  const empty = !status?.last_data_ts;
  const liveCls = status?.overall?.code === "ok" ? "" : status?.overall?.code === "error" ? "err" : "warn";

  const collect = async () => {
    setCollectMsg("actualizando…");
    try { const r = await api.collect(); setCollectMsg(r.status); load(); } catch (e) { setCollectMsg(String(e)); }
  };

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="brand"><Logo /><div><b>Río Chubut</b><small>Monitor hidrológico</small></div></div>
          <nav className="sections">
            {NAV.map(([id, l]) => (
              <a key={id} href={`#${id}`}>{l}{id === "alertas" && activeAlerts.length ? <span className="count">{activeAlerts.length}</span> : null}</a>
            ))}
          </nav>
          <span className={`live ${liveCls}`} title={status?.overall?.label}><span className="dot" /><span className="txt">Datos INA en vivo</span></span>
          <button className="small ghost" onClick={toggleTheme} title="Cambiar tema" aria-label="Cambiar tema">{theme === "dark" ? "☀" : "☾"}</button>
        </div>
      </header>

      <main className="wrap">
        <section id="estado" style={{ marginTop: 22 }}>
          <div className="hero card">
            <div>
              <h1>Estado del Río Chubut</h1>
              <Headline main={main} prop={prop} fcTop={forecastTop(fc)} />
              <div className="meta">
                {status?.overall?.label} · Último dato: <b>{status?.last_data_local || "—"}</b>{status?.last_data_ts && ` (${ago(status.last_data_ts)})`}
                {" · "}Actualizado: {status?.collector?.last_cycle?.at ? fDateTime(status.collector.last_cycle.at).slice(-5) : "—"}
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              {collectMsg && <span className="small muted">{collectMsg}</span>}
              <button onClick={collect}>↻ Actualizar</button>
            </div>
          </div>
          {err && <div className="msg crit">{err}</div>}
          {empty && <div className="msg warn">No llegaron datos del INA. Puede estar caído o lento: la página reintenta sola cada 5 minutos.</div>}
          <Kpis status={status} main={main} rain={rain} alerts={alerts} />
        </section>

        <section>
          <h2>Perfil de la cuenca <span className="hint">aguas arriba → aguas abajo · cada estación comparada con su propio nivel normal · tiempos de viaje estimados</span></h2>
          <RiverProfile main={main} prop={prop} dam={dam} />
        </section>

        <section>
          <h2>Estaciones principales <span className="hint">número grande = desvío respecto de lo normal de esa estación · la lectura de escala no es profundidad</span></h2>
          <div className="chain">{main.map((s) => <StationCard key={s.key} s={s} />)}</div>
          <div className="grid g2" style={{ marginTop: 14 }}>
            <FloodPanel floods={floods} />
            <DamSummary dam={dam} stations={stations} />
          </div>
        </section>

        <section id="tabla">
          <h2>Todas las estaciones <span className="hint">incluye cabecera, afluentes, pluviómetros y el río aguas abajo del dique</span></h2>
          <StationTable stations={[...main, ...others]} />
        </section>

        <section id="graficos">
          <h2>Evolución <span className="hint">zoom con rueda o arrastre · superponé estaciones para ver la crecida viajar aguas abajo</span></h2>
          <LevelChart key={theme} stations={stations} initial={main[0]?.key || "cerro_condor"} />
        </section>

        <section id="comparacion">
          <h2>Comparación con el pasado</h2>
          <StatsPanel key={theme} stations={stations} selected={statsKey} onSelect={setStatsKey} />
        </section>

        <section id="lluvia">
          <h2>Precipitaciones</h2>
          <RainPanel key={theme} rain={rain} stations={stations} />
        </section>

        <section id="pronostico">
          <h2>Pronóstico de lluvia <span className="hint">próximos días · modelos Open-Meteo</span></h2>
          <ForecastPanel fc={fc} err={fcErr} />
        </section>

        <section id="propagacion">
          <h2>Propagación de la crecida <span className="hint">estimación estadística, no pronóstico oficial</span></h2>
          <PropagationPanel key={theme} prop={prop} />
        </section>

        <section id="mapa">
          <h2>Mapa de la cuenca</h2>
          <MapPanel key={theme} stations={stations} rain={rain} dam={dam} />
        </section>

        <section id="dique">
          <h2>Dique Florentino Ameghino</h2>
          <DamPanel dam={dam} stations={stations} reload={load} />
        </section>

        <section id="alertas">
          <h2>Alertas</h2>
          <AlertsPanel alerts={alerts} reload={load} />
        </section>

        <section id="datos">
          <h2>Exportar datos</h2>
          <ExportPanel stations={stations} />
          <h2 style={{ marginTop: 24 }}>Configuración</h2>
          <ConfigPanel stations={stations} reloadAll={load} />
          <h2 style={{ marginTop: 24 }}>Estado de las fuentes</h2>
          <SystemPanel status={status} />
        </section>
      </main>

      <footer className="foot">
        <div className="wrap">
          <span>Datos: Instituto Nacional del Agua (INA) — <a href="https://alerta.ina.gob.ar/" target="_blank" rel="noreferrer">alerta.ina.gob.ar</a>, Red Hidrológica Nacional. Horarios en hora argentina.</span>
          <span>No es un sistema oficial de alerta. Las propagaciones son estimaciones estadísticas.</span>
        </div>
      </footer>
    </>
  );
}
