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
