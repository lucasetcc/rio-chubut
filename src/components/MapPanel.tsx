import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CircleMarker, LayersControl, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import { Station } from "../api";
import { ago, cm, cssVar, fDateTime, num } from "../fmt";

const STATUS_COLOR: Record<string, string> = { stable: "var(--ok)", rising: "var(--rise)", falling: "var(--fall)", flood: "var(--flood)" };

const rainIcon = L.divIcon({ className: "", html: `<div style="width:12px;height:12px;background:#5aa0ff;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 0 1px #0006"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] });
const damIcon = L.divIcon({ className: "", html: `<div style="width:18px;height:18px;border-radius:4px;background:#222;border:2px solid #fff;color:#fff;font:700 11px/14px sans-serif;text-align:center;box-shadow:0 0 0 1px #0008">D</div>`, iconSize: [18, 18], iconAnchor: [9, 9] });

export function MapPanel({ stations, rain, dam }: { stations: Station[]; rain: any; dam: any }) {
  const hydro = stations.filter((s) => s.has_level && s.lat != null);
  const rainOnly = stations.filter((s) => s.kind === "rain" && s.lat != null);
  const rainBy: Record<string, any> = Object.fromEntries((rain?.stations || []).map((r: any) => [r.key, r]));
  const chain = hydro.filter((s) => s.chain_order != null).sort((a, b) => (a.chain_order! - b.chain_order!));
  const damPos: [number, number] = [dam?.lat ?? -43.698, dam?.lon ?? -66.475];
  const schematic: [number, number][] = [...chain.map((s) => [s.lat, s.lon] as [number, number]), damPos];

  const rainLine = (r: any) => r ? `Lluvia 24 h: ${r.windows["24h"].mm == null ? "sin datos" : num(r.windows["24h"].mm, 1) + " mm"} · 72 h: ${r.windows["72h"].mm == null ? "sin datos" : num(r.windows["72h"].mm, 1) + " mm"}` : "Sin pluviómetro";

  return (
    <div className="card">
      <div className="map">
        <MapContainer center={[-43.0, -69.0]} zoom={7} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Topográfico (OpenTopoMap)">
              <TileLayer url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" maxZoom={17}
                attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Oscuro (CARTO)">
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" maxZoom={19}
                attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>' />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="OpenStreetMap">
              <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
            </LayersControl.BaseLayer>
          </LayersControl>
          <Polyline positions={schematic} pathOptions={{ color: cssVar("var(--accent)"), weight: 2, dashArray: "6 6", opacity: 0.7 }}>
            <Tooltip sticky>Conexión esquemática entre estaciones (no es el trazado del cauce; el río se ve en el mapa base)</Tooltip>
          </Polyline>
          {hydro.map((s) => {
            const c = cssVar(STATUS_COLOR[s.status?.code || ""] || "var(--stale)");
            const r = rainBy[s.key];
            return (
              <CircleMarker key={s.key} center={[s.lat, s.lon]} radius={s.main ? 10 : 7} pathOptions={{ color: "#fff", weight: 2, fillColor: c, fillOpacity: 0.95 }}>
                <Tooltip direction="top" offset={[0, -8]}>{s.name}</Tooltip>
                <Popup>
                  <b>{s.name}</b> <span style={{ opacity: 0.7 }}>({s.river})</span><br />
                  {s.status?.emoji} {s.status?.label}{s.status?.trend?.cm_per_day != null ? ` · ${num(s.status.trend.cm_per_day, 1)} cm/día` : ""}<br />
                  Nivel: <b>{s.level ? `${num(s.level.value)} m` : "sin datos"}</b>{s.level ? ` (24 h: ${cm(s.level.changes["24h"]?.delta_m)})` : ""}<br />
                  Caudal: <i>sin datos públicos</i><br />
                  {rainLine(r)}<br />
                  Última actualización: {s.level ? `${fDateTime(s.level.ts)} (${ago(s.level.ts)})` : "—"}<br />
                  <a href={s.source.url} target="_blank" rel="noreferrer">Ver fuente original (INA) ↗</a>
                </Popup>
              </CircleMarker>
            );
          })}
          {rainOnly.map((s) => (
            <Marker key={s.key} position={[s.lat, s.lon]} icon={rainIcon}>
              <Tooltip direction="top" offset={[0, -6]}>{s.name}</Tooltip>
              <Popup>
                <b>{s.name}</b><br />{rainLine(rainBy[s.key])}<br />
                Último dato: {rainBy[s.key]?.last_ts ? `${fDateTime(rainBy[s.key].last_ts)} (${ago(rainBy[s.key].last_ts)})` : "sin datos"}<br />
                <a href={s.source.url} target="_blank" rel="noreferrer">Ver fuente original (INA) ↗</a>
              </Popup>
            </Marker>
          ))}
          <Marker position={damPos} icon={damIcon}>
            <Tooltip direction="top" offset={[0, -8]}>Dique Florentino Ameghino</Tooltip>
            <Popup>
              <b>Dique Florentino Ameghino</b><br />
              Cota: {dam?.variables?.cota?.available ? `${num(dam.variables.cota.last.value)} m (MANUAL, ${dam.variables.cota.last.ts_local})` : "sin datos públicos disponibles"}<br />
              Escala del río aguas abajo (INA): ver estación “Ameghino (río aguas abajo del dique)”.
            </Popup>
          </Marker>
        </MapContainer>
      </div>
      <div className="legend-map">
        <span><span style={{ color: cssVar("var(--ok)") }}>●</span> estable</span>
        <span><span style={{ color: cssVar("var(--rise)") }}>●</span> subiendo</span>
        <span><span style={{ color: cssVar("var(--fall)") }}>●</span> bajando</span>
        <span><span style={{ color: cssVar("var(--flood)") }}>●</span> crecida importante</span>
        <span><span style={{ color: cssVar("var(--stale)") }}>●</span> sin actualizar</span>
        <span>◆ pluviómetro</span><span>D dique</span><span>- - conexión esquemática</span>
      </div>
      <div className="src">El Río Chubut y sus afluentes (Gualjaina, Tecka, Chico) se ven en el mapa base de OpenStreetMap/OpenTopoMap. No se dibuja un trazado propio para no inventar geometría.</div>
    </div>
  );
}
