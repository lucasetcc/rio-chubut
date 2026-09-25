/**
 * Configuración compartida (reglas de alerta, umbrales manuales, datos manuales del dique,
 * estaciones agregadas). Se guarda en Netlify Blobs. Leer es público; guardar requiere ADMIN_KEY.
 */
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

const ALLOWED = ["rules", "thresholds", "dam", "dam_limits", "extra_series", "ignored_series", "discovery", "updated_at"];

export default async (req: Request) => {
  const store = getStore({ name: "rio-chubut", consistency: "strong" });
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (req.method === "GET") {
    const v = await store.get("settings", { type: "json" });
    return new Response(JSON.stringify(v || {}), { headers });
  }
  if (req.method === "PUT") {
    const key = process.env.ADMIN_KEY;
    if (!key) return new Response(JSON.stringify({ error: "Falta configurar ADMIN_KEY en Netlify (Site configuration → Environment variables)." }), { status: 500, headers });
    if (req.headers.get("x-admin-key") !== key) return new Response(JSON.stringify({ error: "Clave incorrecta" }), { status: 401, headers });
    let body: any;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "JSON inválido" }), { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return new Response(JSON.stringify({ error: "formato inválido" }), { status: 400, headers });
    const clean: Record<string, unknown> = {};
    for (const k of ALLOWED) if (k in body) clean[k] = body[k];
    clean.updated_at = new Date().toISOString();
    const txt = JSON.stringify(clean);
    if (txt.length > 500_000) return new Response(JSON.stringify({ error: "demasiado grande" }), { status: 413, headers });
    await store.setJSON("settings", clean);
    return new Response(txt, { headers });
  }
  return new Response(JSON.stringify({ error: "método no permitido" }), { status: 405, headers });
};

export const config: Config = { path: "/api/settings" };
