/**
 * Configuración compartida (reglas, umbrales con fuente, datos manuales del dique, estaciones agregadas).
 * Se guarda en Netlify Blobs. Leer es público; guardar requiere ADMIN_KEY.
 * - Comparación de clave en tiempo constante.
 * - Bloqueo por IP tras 5 intentos fallidos en 15 minutos.
 * - Validación de esquema (tipos, números finitos, URLs sólo http/https, longitudes).
 * - Control de concurrencia: si otro guardó en el medio, responde 409.
 */
import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { validateSettings } from "../lib/validate";

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const MAX_FAILS = 5, WINDOW_MS = 15 * 60e3;

function sameKey(given: string, want: string) {
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async (req: Request, context: Context) => {
  const store = getStore({ name: "rio-chubut", consistency: "strong" });
  if (req.method === "GET") {
    const v = await store.get("settings", { type: "json" });
    return reply(v || {});
  }
  if (req.method !== "PUT") return reply({ error: "método no permitido" }, 405);

  const key = process.env.ADMIN_KEY;
  if (!key || key.length < 20) return reply({ error: "ADMIN_KEY no configurada o demasiado corta (mínimo 20 caracteres)." }, 500);

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  const rl = getStore({ name: "rio-chubut-ratelimit", consistency: "strong" });
  const rlKey = `fails:${ip}`;
  const fails: any = (await rl.get(rlKey, { type: "json" })) || { n: 0, first: Date.now() };
  if (Date.now() - fails.first > WINDOW_MS) { fails.n = 0; fails.first = Date.now(); }
  if (fails.n >= MAX_FAILS) return reply({ error: "Demasiados intentos. Probá de nuevo en 15 minutos." }, 429);

  if (!sameKey(req.headers.get("x-admin-key") || "", key)) {
    fails.n++;
    await rl.setJSON(rlKey, fails);
    return reply({ error: "Clave incorrecta" }, 401);
  }
  if (fails.n) await rl.delete(rlKey);

  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "JSON inválido" }, 400); }
  if (JSON.stringify(body).length > 500_000) return reply({ error: "demasiado grande" }, 413);
  const v = validateSettings(body);
  if (!v.ok) return reply({ error: v.error }, 400);

  const current: any = (await store.get("settings", { type: "json" })) || {};
  const expected = req.headers.get("x-if-updated-at") || "";
  if ((current.updated_at || "") !== expected) return reply({ error: "La configuración cambió mientras editabas. Recargá la página." }, 409);

  const clean = { ...v.value, updated_at: new Date().toISOString() };
  await store.setJSON("settings", clean);
  return reply(clean);
};

export const config: Config = { path: "/api/settings" };
