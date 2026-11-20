// Netlify Scheduled Function: cada noche borra las candidaturas caducadas y sus CV
// (3 meses sin casilla de bolsa, 12 meses con ella). Mismas variables que candidatura.mjs.
export const config = { schedule: "0 2 * * *" };

const auth = (k) => (k.startsWith("sb_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` });

export default async () => {
  const URL_ = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const KEY = String(process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!URL_ || !KEY) { console.error("config"); return; }
  const now = Date.now(), d = (m) => new Date(now - m * 30.44 * 864e5).toISOString();
  const filtro = `or=(and(bolsa.eq.false,created_at.lt.${d(3)}),created_at.lt.${d(12)})`;

  const r = await fetch(`${URL_}/rest/v1/candidaturas?select=id,cv_path&${filtro}`, { headers: auth(KEY) });
  if (!r.ok) { console.error("leer", r.status); return; }
  const filas = await r.json();
  const cvs = filas.map((f) => f.cv_path).filter(Boolean);
  if (cvs.length) {
    const del = await fetch(`${URL_}/storage/v1/object/cv`, {
      method: "DELETE", headers: { ...auth(KEY), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: cvs }),
    });
    if (!del.ok) { console.error("borrar cv", del.status); return; } // si falla, no borramos las filas para no dejar CV huérfanos
  }
  if (filas.length) {
    const ids = filas.map((f) => f.id).join(",");
    const dr = await fetch(`${URL_}/rest/v1/candidaturas?id=in.(${ids})`, { method: "DELETE", headers: auth(KEY) });
    if (!dr.ok) console.error("borrar filas", dr.status);
  }
  console.log(`limpieza: ${filas.length} candidaturas, ${cvs.length} CV`);
};
