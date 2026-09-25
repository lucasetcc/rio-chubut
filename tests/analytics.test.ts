import { describe, expect, it } from "vitest";
import {
  CFG, D, H, P, changes, damBalance, floodDetection, lagCorrelation, localDate, propagation, rainDaily, rainSum, rainSummary,
  stationStats, stationStatus, trend, riseEvents, travelTime, combineMethods, glofasAnalyze, spearman,
} from "../src/data/analytics";

const NOW = Date.parse("2026-09-25T03:00:00Z");
const series = (end: number, n: number, stepH: number, f: (i: number) => number): P[] =>
  Array.from({ length: n }, (_, i) => [end - (n - 1 - i) * stepH * H, f(i)] as P);

describe("lluvia", () => {
  it("sin registros válidos es null, nunca 0", () => {
    const r = rainSummary([], NOW - 2 * H, NOW);
    expect(r.windows["24h"].mm).toBeNull();
    expect(r.month_to_date.mm).toBeNull();
  });
  it("registros válidos en 0 dan 0 mm", () => {
    const pts: P[] = [[NOW - 5 * H, 0], [NOW - 3 * H, 0], [NOW - 1 * H, 0]];
    expect(rainSummary(pts, NOW - H, NOW).windows["24h"].mm).toBe(0);
  });
  it("un registro exactamente en now − 24 h queda afuera (misma regla en tabla y alerta)", () => {
    const pts: P[] = [[NOW - 24 * H, 10], [NOW - 2 * H, 2]];
    expect(rainSummary(pts, NOW - 2 * H, NOW).windows["24h"].mm).toBe(2);
    expect(rainSum(pts, NOW - 24 * H, NOW).mm).toBe(2);
  });
  it("día sin registros es null en la serie diaria (≠ 0 mm)", () => {
    const pts: P[] = [[Date.parse("2026-09-23T15:00:00Z"), 4]];
    const d = rainDaily(pts, Date.parse("2026-09-22T12:00:00Z"), NOW);
    expect(d.find((x) => x.date === "2026-09-22")?.mm).toBeNull();
    expect(d.find((x) => x.date === "2026-09-23")?.mm).toBe(4);
  });
});

describe("estado de estación", () => {
  it("un dato viejo nunca es subida ni umbral: SIN ACTUALIZAR", () => {
    const pts = series(NOW - 10 * D, 13, 2, (i) => 2 + i * 0.05);
    const st = stationStatus(pts, { crecida_m: 1, source: "X", url: "https://x" }, NOW);
    expect(st.code).toBe("stale");
  });
  it("no existe más la 'crecida importante' automática: sin umbral cargado nunca es 'over'", () => {
    const pts = series(NOW, 13, 2, (i) => 5 + i * 0.1);
    expect(stationStatus(pts, null, NOW).code).toBe("rising");
  });
  it("umbral cargado sin fuente no se usa", () => {
    const pts = series(NOW, 13, 2, () => 3);
    expect(stationStatus(pts, { crecida_m: 1 } as any, NOW).code).not.toBe("over");
    expect(stationStatus(pts, { crecida_m: 1, source: "IPA", url: "https://ipa" }, NOW).code).toBe("over");
  });
});

describe("cambios y subidas", () => {
  it("serie parada hace 3 días: stale y sin mensajes en presente", () => {
    const pts = series(NOW - 3 * D, 200, 4, (i) => 1 + i * 0.01);
    const f = floodDetection("X", pts, NOW);
    expect(f.stale).toBe(true);
    expect(f.messages).toHaveLength(0);
    expect(f.rapid_rise).toBe(false);
  });
  it("referencia fuera de tolerancia: delta null con motivo", () => {
    const pts: P[] = [[NOW - 40 * H, 1], [NOW, 1.2]];
    const c = changes(pts);
    expect(c["24h"].delta_m).toBeNull();
    expect(c["24h"].reason).toBeTruthy();
  });
});

describe("promedios y percentil", () => {
  it("1 día con datos en 7: promedio null", () => {
    const pts: P[] = [[NOW - 2 * D, 1], [NOW - 2 * D + H, 1.1]];
    const s = stationStats(pts, NOW);
    expect(s.windows["7d"].mean).toBeNull();
    expect(s.windows["7d"].days_with_data).toBe(1);
  });
  it("31 días de historia: sin percentil ni clase", () => {
    const pts = series(NOW, 31 * 6, 4, (i) => 1 + (i % 5) * 0.01);
    const s = stationStats(pts, NOW);
    expect(s.percentile_rank_hist).toBeNull();
    expect(s.same_month_climatology.ok).toBe(false);
  });
  it("con 3 septiembres anteriores sí hay percentil (mismo mes)", () => {
    const pts: P[] = [];
    for (const y of [2023, 2024, 2025]) for (let d = 1; d <= 30; d++) pts.push([Date.parse(`${y}-09-${String(d).padStart(2, "0")}T15:00:00Z`), 1 + d / 100]);
    pts.push([NOW - H, 2]);
    const s = stationStats(pts, NOW);
    expect(s.same_month_climatology.ok).toBe(true);
    expect(s.percentile_rank_hist).toBe(100);
  });
});

describe("tendencia", () => {
  it("+2 cm en 16 h (resolución 1 cm) es ESTABLE", () => {
    const pts: P[] = [[NOW - 16 * H, 1.0], [NOW - 12 * H, 1.0], [NOW - 8 * H, 1.01], [NOW - 4 * H, 1.01], [NOW, 1.02]];
    expect(trend(pts).label).toBe("ESTABLE");
  });
  it("+10 cm en 24 h con pasos regulares es SUBIENDO", () => {
    const pts = series(NOW, 7, 4, (i) => 1 + i * 0.0167);
    expect(trend(pts).label).toBe("SUBIENDO");
  });
});

describe("fechas y conversiones", () => {
  it("el día argentino corta a las 03:00 UTC", () => {
    expect(localDate(Date.parse("2026-09-25T02:59:00Z"))).toBe("2026-09-24");
    expect(localDate(Date.parse("2026-09-25T03:00:00Z"))).toBe("2026-09-25");
  });
  it("balance 50 − 10 m³/s = 3,456 hm³/día, sólo con caudales del mismo día", () => {
    expect(damBalance({ value: 50, ts: "2026-09-24T15:00:00Z" }, { value: 10, ts: "2026-09-24T15:00:00Z" })).toBeCloseTo(3.456, 3);
    expect(damBalance({ value: 50, ts: "2026-09-24T15:00:00Z" }, { value: 10, ts: "2026-08-04T15:00:00Z" })).toBeNull();
  });
});

describe("propagación", () => {
  it("recupera un desfase conocido y exige r ≥ 0,6", () => {
    const wave = (t: number) => 1 + 0.3 * Math.sin(t / (36 * H)) + 0.2 * Math.sin(t / (9 * H));
    const up = series(NOW, 24 * 120, 1, (i) => wave(NOW - (24 * 120 - 1 - i) * H));
    const down = series(NOW, 24 * 120, 1, (i) => wave(NOW - (24 * 120 - 1 - i) * H - 20 * H));
    const r: any = lagCorrelation(up, down, 120);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.lag_h - 20)).toBeLessThanOrEqual(3);
    expect(r.r).toBeGreaterThanOrEqual(CFG.propagationMinR);
  });
  it("sin correlación no se estima", () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const up = series(NOW, 24 * 60, 1, () => rnd());
    const down = series(NOW, 24 * 60, 1, () => rnd());
    expect((lagCorrelation(up, down, 120) as any).ok).toBe(false);
  });
  it("estación sin actualizar no genera señales", () => {
    const up = series(NOW - 5 * D, 300, 4, (i) => 1 + i * 0.02);
    const p = propagation([{ key: "a", name: "A" }], { a: up }, NOW);
    expect(p.signals).toHaveLength(0);
  });
});

describe("tiempo de viaje por crecidas", () => {
  // crecidas cada ~23 días de distinta magnitud + ciclo diario de deshielo ±5 cm + ruido de 1 cm
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const floods = Array.from({ length: 14 }, (_, k) => ({ t: NOW - 330 * D + k * 23 * D + rnd() * 5 * D, a: 0.3 + rnd() * 1.5 }));
  const hydro = (t: number, lagH: number, att: number) =>
    1 + floods.reduce((s, f) => { const x = (t - f.t - lagH * H) / H; return s + (x < 0 ? f.a * Math.exp(-(x * x) / 200) : f.a * Math.exp(-x / 40)) * att; }, 0);
  const up = series(NOW, 24 * 90 * 4, 4, (i) => { const t = NOW - (24 * 90 * 4 - 1 - i) * 4 * H; return hydro(t, 0, 1) + 0.05 * Math.sin((2 * Math.PI * t) / D) + Math.round(rnd() * 2) / 100; });
  const down = series(NOW, 24 * 360, 1, (i) => { const t = NOW - (24 * 360 - 1 - i) * H; return hydro(t, 30, 0.4) + 0.3; });
  it("detecta las crecidas e ignora el ciclo diario", () => {
    const ev = riseEvents(up, 0.1);
    expect(ev.length).toBeGreaterThanOrEqual(12);
    expect(ev.length).toBeLessThanOrEqual(15);
  });
  it("recupera una demora de 30 h entre picos", () => {
    const r: any = travelTime(riseEvents(up, 0.1), riseEvents(down, 0.03), 120);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.lag_h - 30)).toBeLessThanOrEqual(4);
    expect(r.n_events).toBeGreaterThanOrEqual(10);
  });
  it("sin crecidas aguas abajo no inventa un tiempo", () => {
    const flat = series(NOW, 24 * 360, 1, () => 1);
    expect((travelTime(riseEvents(up, 0.1), riseEvents(flat, 0.03), 120) as any).ok).toBe(false);
  });
});

describe("mezcla de métodos", () => {
  const ev = { ok: true, lag_h: 30, lag_range_h: [27, 33], n_events: 9, events: [] };
  it("si coinciden se promedian con confianza alta", () => {
    const r: any = combineMethods(ev, { ok: true, lag_h: 34, lag_range_h: [32, 36], r: 0.7 });
    expect(r.method).toBe("crecidas + correlación");
    expect(r.lag_h).toBe(32);
    expect(r.confidence).toBe("alta");
  });
  it("correlación débil (0,45) sólo sirve para confirmar", () => {
    expect((combineMethods(ev, { ok: false, lag_h: 31, r: 0.45 }) as any).agree).toBe(true);
    expect((combineMethods({ ok: false, n_events: 1, reason: "x" }, { ok: false, lag_h: 31, r: 0.45, reason: "y" }) as any).ok).toBe(false);
  });
  it("si no coinciden, rango entre ambos y confianza baja", () => {
    const r: any = combineMethods({ ...ev, n_events: 3 }, { ok: true, lag_h: 70, lag_range_h: [68, 72], r: 0.65 });
    expect(r.confidence).toBe("baja");
    expect(r.lag_range_h).toEqual([27, 70]);
  });
});

describe("caudal modelado (GloFAS)", () => {
  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + "T12:00:00Z") + i * D).toISOString().slice(0, 10));
  const ht = days("1990-01-01", 35 * 365);
  const hist = { time: ht, river_discharge: ht.map((t) => 40 + 30 * Math.sin((2 * Math.PI * (Date.parse(t) / D)) / 365.25)) };
  it("percentil contra el mismo período de todos los años", () => {
    const rt = days("2026-07-27", 91);
    const today = "2026-09-25";
    const rec = { time: rt, river_discharge: rt.map(() => 1e6) };
    const a = glofasAnalyze(rec, hist, today);
    expect(a.pct).toBe(100);
    expect(a.cls?.label).toBe("muy alto");
    expect(a.years).toBeGreaterThanOrEqual(30);
  });
  it("sin historia suficiente no hay clase", () => {
    const rt = days("2026-07-27", 91);
    const a = glofasAnalyze({ time: rt, river_discharge: rt.map(() => 5) }, { time: ht.slice(0, 200), river_discharge: hist.river_discharge.slice(0, 200) }, "2026-09-25");
    expect(a.pct).toBeNull();
    expect(a.cls).toBeNull();
  });
  it("spearman: +1 si suben juntos, −1 si van al revés, null con pocos datos", () => {
    const a = Array.from({ length: 60 }, (_, i) => i), b = a.map((x) => x * x);
    expect(spearman(a, b)).toBe(1);
    expect(spearman(a, b.map((x) => -x))).toBe(-1);
    expect(spearman([1, 2, 3], [1, 2, 3])).toBeNull();
  });
});
