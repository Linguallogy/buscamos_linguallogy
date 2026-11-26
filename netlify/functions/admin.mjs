// Panel de candidaturas para Ilya: /api/admin (protegido con ADMIN_PASSWORD)
// Acciones: list (todas las candidaturas + enlace temporal al CV), update (estado / notas), delete.
import { timingSafeEqual } from "node:crypto";

export const config = { path: "/api/admin" };

const auth = (k) => (k.startsWith("sb_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` });
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const ESTADOS = ["nueva", "invitado", "llamar", "entrevista", "prueba", "colabora", "espera", "descartada"];

function okPass(p) {
  const real = String(process.env.ADMIN_PASSWORD || "");
  if (!real || typeof p !== "string") return false;
  const a = Buffer.from(p), b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!process.env.ADMIN_PASSWORD) return json(500, { error: "Falta ADMIN_PASSWORD en Netlify" });
  let body; try { body = await req.json(); } catch { return json(400, { error: "json" }); }
  if (!okPass(body.password)) { await new Promise((r) => setTimeout(r, 800)); return json(401, { error: "password" }); }

  const URL_ = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const KEY = String(process.env.SUPABASE_SERVICE_KEY || "").trim();
  const H = auth(KEY);

  if (body.action === "list") {
    const r = await fetch(`${URL_}/rest/v1/candidaturas?select=*&order=created_at.desc&limit=1000`, { headers: H });
    if (!r.ok) return json(500, { error: `supabase ${r.status}` });
    const rows = await r.json();
    // enlaces temporales (2 h) a los CV del bucket privado
    const paths = rows.map((x) => x.cv_path).filter(Boolean);
    if (paths.length) {
      const s = await fetch(`${URL_}/storage/v1/object/sign/cv`, {
        method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 7200, paths }),
      });
      if (s.ok) {
        const list = await s.json();
        const map = Object.fromEntries(list.filter((x) => x.signedURL).map((x) => [x.path, `${URL_}/storage/v1${x.signedURL}`]));
        rows.forEach((x) => { if (x.cv_path) x.cv_url = map[x.cv_path] || null; });
      }
    }
    return json(200, { rows });
  }

  if (body.action === "update") {
    const id = Number(body.id);
    const patch = {};
    if (ESTADOS.includes(body.estado)) patch.estado = body.estado;
    if (typeof body.notas === "string") patch.notas = body.notas.slice(0, 4000);
    if (!id || !Object.keys(patch).length) return json(400, { error: "invalid" });
    const r = await fetch(`${URL_}/rest/v1/candidaturas?id=eq.${id}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    return r.ok ? json(200, { ok: true }) : json(500, { error: `supabase ${r.status}` });
  }

  if (body.action === "delete") {
    const id = Number(body.id);
    if (!id) return json(400, { error: "invalid" });
    const g = await fetch(`${URL_}/rest/v1/candidaturas?id=eq.${id}&select=cv_path`, { headers: H });
    const [row] = g.ok ? await g.json() : [];
    if (row && row.cv_path) {
      await fetch(`${URL_}/storage/v1/object/cv`, { method: "DELETE", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [row.cv_path] }) });
    }
    const r = await fetch(`${URL_}/rest/v1/candidaturas?id=eq.${id}`, { method: "DELETE", headers: H });
    return r.ok ? json(200, { ok: true }) : json(500, { error: `supabase ${r.status}` });
  }

  return json(400, { error: "action" });
};
