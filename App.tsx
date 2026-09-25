import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, Station } from "./api";
import { AlertsPanel } from "./components/AlertsConfig";
import { DamSummary } from "./components/DamPanel";
import { ForecastMini, ForecastPanel, forecastTop } from "./components/Forecast";
import { Headline, Kpis, RiverProfile } from "./components/Overview";
import { StationCard, StationTable } from "./components/StationCards";
import { S } from "./data/engine";
import { ago, fDateTime } from "./fmt";

// Pestañas pesadas (gráficos, mapa, admin) se cargan recién cuando se abren
const LevelChart = lazy(() => import("./components/Charts").then((m) => ({ default: m.LevelChart })));
const StatsPanel = lazy(() => import("./components/StatsPanel").then((m) => ({ default: m.StatsPanel })));
const RainPanel = lazy(() => import("./components/RainPanel").then((m) => ({ default: m.RainPanel })));
const PropagationPanel = lazy(() => import("./components/Propagation").then((m) => ({ default: m.PropagationPanel })));
const FloodPanel = lazy(() => import("./components/Propagation").then((m) => ({ default: m.FloodPanel })));
const MapPanel = lazy(() => import("./components/MapPanel").then((m) => ({ default: m.MapPanel })));
const DamPanel = lazy(() => import("./components/DamPanel").then((m) => ({ default: m.DamPanel })));
const ConfigPanel = lazy(() => import("./components/AlertsConfig").then((m) => ({ default: m.ConfigPanel })));
const ExportPanel = lazy(() => import("./components/AlertsConfig").then((m) => ({ default: m.ExportPanel })));
const SystemPanel = lazy(() => import("./components/AlertsConfig").then((m) => ({ default: m.SystemPanel })));

const TABS = [["resumen", "Resumen"], ["evolucion", "Evolución"], ["lluvia", "Lluvia"], ["crecidas", "Indicadores"], ["mapa", "Mapa"], ["dique", "Dique"]];

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

// Configuración, exportación y estado técnico: sólo con ?admin en la dirección
const ADMIN = typeof location !== "undefined" && new URLSearchParams(location.search).has("admin");

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
  const readTab = () => { const h = location.hash.replace("#", ""); return [...TABS.map((t) => t[0]), "admin"].includes(h) ? h : "resumen"; };
  const [tab, setTab] = useState<string>(readTab);
  useEffect(() => {
    const f = () => { setTab(readTab()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const go = (t: string) => { location.hash = t; };
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
    // refresco cada 5 min, sólo si la pestaña está visible (en segundo plano no consume)
    const t = setInterval(async () => { if (document.hidden) return; await api.collect().catch(() => {}); load(); }, 5 * 60_000);
    const onVis = () => { if (!document.hidden && Date.now() - S.loadedAt > 5 * 60_000) api.collect().then(load).catch(() => {}); };
    document.addEventListener("visibilitychange", onVis);
    // barra de progreso: sólo mientras se hace la primera carga
    const p = setInterval(() => {
      setProgress((cur) => (cur.done !== S.progress.done || cur.total !== S.progress.total ? { ...S.progress } : cur));
      if (S.loadedAt) clearInterval(p);
    }, 300);
    return () => { clearInterval(t); clearInterval(p); document.removeEventListener("visibilitychange", onVis); };
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
            {[...TABS, ...(ADMIN ? [["admin", "Admin"]] : [])].map(([id, l]) => (
              <a key={id} href={`#${id}`} className={tab === id ? "on" : ""}>{l}{id === "crecidas" && activeAlerts.length ? <span className="count">{activeAlerts.length}</span> : null}</a>
            ))}
          </nav>
          <span className={`live ${liveCls}`} title={`${status?.overall?.label || ""} · datos del INA, se consultan cada 10 min`}><span className="dot" /><span className="txt">Consultado {status?.collector?.last_cycle?.at ? fDateTime(status.collector.last_cycle.at).slice(-5) : "—"} ART</span></span>
          <button className="small ghost" onClick={toggleTheme} title="Cambiar tema" aria-label="Cambiar tema">{theme === "dark" ? "☀" : "☾"}</button>
        </div>
      </header>

      <main className="wrap">
        <Suspense fallback={<div className="card muted" style={{ marginTop: 22 }}>Cargando…</div>}>
        {tab === "resumen" && <>
          <section style={{ marginTop: 22 }}>
            <div className="hero card">
              <div>
                <h1>Estado del Río Chubut</h1>
                <Headline main={main} prop={prop} fcTop={forecastTop(fc)} />
                <div className="meta">
                  Último dato recibido: <b>{status?.last_data_local || "—"} ART</b>{status?.last_data_ts && ` (${ago(status.last_data_ts)})`} · {status?.overall?.label}
                </div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                {collectMsg && <span className="small muted">{collectMsg}</span>}
                <button onClick={collect}>↻ Actualizar</button>
              </div>
            </div>
            {err && <div className="msg crit">{err}</div>}
            {empty && <div className="msg warn">No llegaron datos del INA. Puede estar caído o lento: la página reintenta sola cada 5 minutos.</div>}
            {activeAlerts.slice(0, 3).map((a) => <div key={a.id} className="msg warn" style={{ cursor: "pointer" }} onClick={() => go("crecidas")}><span className="tag tag-calc">INDICADOR PROPIO</span> {a.message}</div>)}
            <Kpis status={status} main={main} rain={rain} alerts={alerts} />
          </section>
          <section>
            <h2>El río, de la cabecera al dique <span className="hint">cada estación comparada con su propio nivel normal</span></h2>
            <RiverProfile main={main} prop={prop} dam={dam} />
          </section>
          <section>
            <h2>Estaciones <span className="hint">número grande = lectura de la regla de cada estación (no es profundidad ni se compara entre estaciones)</span></h2>
            <div className="chain">{main.map((s) => <StationCard key={s.key} s={s} />)}</div>
          </section>
          <section>
            <div className="grid g2">
              <DamSummary dam={dam} stations={stations} />
              <div className="card">
                <h4>Pronóstico de lluvia (3 días)</h4>
                <ForecastMini fc={fc} />
                <button className="small" style={{ marginTop: 10 }} onClick={() => go("lluvia")}>Ver pronóstico completo →</button>
              </div>
            </div>
          </section>
        </>}

        {tab === "evolucion" && <>
          <section style={{ marginTop: 22 }}>
            <h2>Evolución del nivel <span className="hint">zoom con rueda o arrastre · superponé estaciones para ver la crecida viajar</span></h2>
            <LevelChart key={theme} stations={stations} initial={main[0]?.key || "cerro_condor"} />
          </section>
          <section>
            <h2>Comparación con el pasado</h2>
            <StatsPanel key={theme} stations={stations} selected={statsKey} onSelect={setStatsKey} />
          </section>
          <section>
            <h2>Todas las estaciones</h2>
            <StationTable stations={[...main, ...others]} />
          </section>
        </>}

        {tab === "lluvia" && <>
          <section style={{ marginTop: 22 }}>
            <h2>Pronóstico de lluvia <span className="hint">próximos días · modelos Open-Meteo</span></h2>
            <ForecastPanel fc={fc} err={fcErr} />
          </section>
          <section>
            <h2>Lluvia medida</h2>
            <RainPanel key={theme} rain={rain} stations={stations} />
          </section>
        </>}

        {tab === "crecidas" && <>
          <section style={{ marginTop: 22 }}>
            <h2>Indicadores automáticos <span className="hint">criterio propio, no oficial</span></h2>
            <AlertsPanel alerts={alerts} reload={load} />
          </section>
          <section>
            <h2>Propagación <span className="hint">estimación estadística, no pronóstico oficial</span></h2>
            <PropagationPanel key={theme} prop={prop} />
          </section>
          <section>
            <h2>Subidas detectadas <span className="hint">criterio propio</span></h2>
            <FloodPanel floods={floods} />
          </section>
        </>}

        {tab === "mapa" && <section style={{ marginTop: 22 }}>
          <h2>Mapa de la cuenca</h2>
          <MapPanel key={theme} stations={stations} rain={rain} dam={dam} />
        </section>}

        {tab === "dique" && <section style={{ marginTop: 22 }}>
          <h2>Dique Florentino Ameghino</h2>
          <DamPanel dam={dam} stations={stations} reload={load} admin={ADMIN} />
        </section>}

        {tab === "admin" && ADMIN && <section style={{ marginTop: 22 }}>
          <h2>Exportar datos</h2>
          <ExportPanel stations={stations} />
          <h2 style={{ marginTop: 24 }}>Configuración</h2>
          <ConfigPanel stations={stations} reloadAll={load} />
          <h2 style={{ marginTop: 24 }}>Estado de las fuentes</h2>
          <SystemPanel status={status} />
        </section>}
        </Suspense>
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
