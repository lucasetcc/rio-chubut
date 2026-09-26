import { describe, expect, it } from "vitest";
import { okBucket, safeUrl, validateSettings } from "../netlify/lib/validate";

const NOW = Date.parse("2026-09-25T03:00:00Z");

describe("proxy: bucket de caché", () => {
  it("acepta sólo el bucket actual ±1", () => {
    const cur = Math.floor(NOW / 600e3);
    expect(okBucket(String(cur), 600e3, NOW)).toBe(true);
    expect(okBucket(String(cur + 1), 600e3, NOW)).toBe(true);
    expect(okBucket(String(cur + 5), 600e3, NOW)).toBe(false);
    expect(okBucket("audit-test-1", 600e3, NOW)).toBe(false);
    expect(okBucket(undefined, 600e3, NOW)).toBe(false);
  });
});

describe("URLs", () => {
  it("sólo http/https", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("https://www.red43.com.ar/x")).toBe("https://www.red43.com.ar/x");
  });
});

describe("settings: validación de esquema", () => {
  it("rechaza source_url javascript: en el dique", () => {
    const r = validateSettings({ dam: [{ ts: "2026-09-24T15:00:00Z", variable: "cota", value: 133, source: "x", source_url: "javascript:alert(1)" }] });
    expect(r.ok).toBe(false);
  });
  it("rechaza tipos rotos que tirarían la página", () => {
    expect(validateSettings({ dam: "x" }).ok).toBe(false);
    expect(validateSettings({ rules: [{ id: 1, type: "rise", params: { cm: "diez" } }] }).ok).toBe(false);
    expect(validateSettings({ dam: [{ ts: "x", variable: "cota", value: Infinity, source: "s" }] }).ok).toBe(false);
  });
  it("umbral sin fuente o sin URL se rechaza", () => {
    expect(validateSettings({ thresholds: { cerro_condor: { crecida_m: 2.5 } } }).ok).toBe(false);
    expect(validateSettings({ thresholds: { cerro_condor: { crecida_m: 2.5, source: "IPA", url: "https://ipa.chubut.gov.ar" } } }).ok).toBe(true);
  });
  it("acepta una configuración válida y limpia nombres", () => {
    const r: any = validateSettings({ extra_series: [{ series_id: 1, ina_station_id: 2, role: "level", station_key: "ina_2", name: "<img src=x onerror=1>Est" }] });
    expect(r.ok).toBe(true);
    expect(r.value.extra_series[0].name).not.toMatch(/[<>]/);
  });
});

describe("lluvia parcial", () => {
  it("1 registro de 6 habituales en 24 h se marca parcial", async () => {
    const { rainSummary, H, D } = await import("../src/data/analytics");
    const pts: [number, number][] = [];
    for (let d = 2; d < 20; d++) for (let k = 0; k < 6; k++) pts.push([NOW - d * D + k * 4 * H, 0]);
    pts.push([NOW - 2 * H, 0.4]);
    const w = rainSummary(pts, NOW - 2 * H, NOW).windows["24h"];
    expect(w.mm).toBe(0.4);
    expect(w.partial).toBe(true);
  });
});

describe("historia de la red anterior (BDHI)", () => {
  const H = 3600e3;
  const mk = (from: number, n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ t: from + i * H, v: f(i), q: "VALID" as const }));
  const setup = async (extShift: number, extNoise = 0) => {
    const E = await import("../src/data/engine");
    E.S.stations = [{ key: "x", name: "X", river: "", kind: "hydro", main: true, chain_order: 1, ina_station_id: 1, lat: 0, lon: 0, notes: "",
      series: [{ id: 1, role: "level", var_id: 2 }, { id: 2, role: "level_ext", var_id: 2 }] }] as any;
    const t0 = Date.parse("2021-09-01T00:00:00Z");
    E.S.series.set(1, { def: { id: 1, role: "level", var_id: 2 }, station: "x", verify: "ok", issues: [], obs: mk(t0, 500, (i) => 1 + (i % 24) / 100) } as any);
    E.S.series.set(2, { def: { id: 2, role: "level_ext", var_id: 2 }, station: "x", verify: "ok", issues: [],
      obs: mk(t0 - 1000 * H, 1200, (i) => 1 + ((i - 1000 + 2400) % 24) / 100 - extShift + (extNoise ? ((i * 7919) % 11) / 100 - 0.05 : 0)) } as any);
    E.S.version++;
    return E;
  };
  it("si coinciden en el período común, antepone la historia", async () => {
    const E = await setup(0);
    expect(E.usable("x").length).toBe(1500);
    expect(E.extInfo("x")?.used).toBe(true);
  });
  it("corrimiento constante de cero: se corrige", async () => {
    const E = await setup(0.5);
    const p = E.usable("x");
    expect(E.extInfo("x")?.offset_m).toBeCloseTo(0.5, 2);
    expect(p[0][1]).toBeCloseTo(1.08, 2);
  });
  it("si no coinciden (ruido), no se une", async () => {
    const E = await setup(0, 1);
    expect(E.usable("x").length).toBe(500);
    expect(E.extInfo("x")?.used).toBe(false);
  });
});

describe("proxy GloFAS", () => {
  it("sólo permite historia de los puntos candidatos", async () => {
    const m = await import("../netlify/functions/glofas.mts");
    const c = m.candidates();
    expect(c.length).toBe(30);
    const bad = await m.default(new Request("https://x/api/glofas/hist/-10/-60"));
    expect(bad.status).toBe(404);
    const badB = await m.default(new Request("https://x/api/glofas/recent/audit-test"));
    expect(badB.status).toBe(400);
  });
});
