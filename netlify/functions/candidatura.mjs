// Netlify Function: recibe la candidatura, recalcula filtros y puntuación en el servidor,
// la guarda en Supabase (UE), avisa por Telegram (solo nº y puntuación) y envía acuse por email.
// Variables de entorno (Netlify > Site configuration > Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
//   RESEND_API_KEY, MAIL_FROM (p. ej. "Linguallogy <info@linguallogy.com>"), ADMIN_URL (opcional)

export const config = { path: "/api/candidatura" };

const CFG = {
  acceptNonNative: ["C2", "C1"],
  weekdays: 5, classMin: 90, slotsForFull: 5, passThreshold: 70,
  weights: { slots: 17, clientes: 14, corporativo: 15, ele: 12, anos: 13, niveles: 3, idiomas: 8, online: 6, nivel: 2, dele: 4, enlaces: 6 }, // la modalidad no puntúa
};

const arr = (x) => (Array.isArray(x) ? x.map(String) : []);
const str = (x, max = 1000) => (typeof x === "string" ? x.trim().slice(0, max) : "");
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t)); return m ? +m[1] * 60 + +m[2] : NaN; };

function intervals(disp, day) {
  const iv = disp.filter((x) => +x.dia === day).map((x) => [toMin(x.de), toMin(x.a)]).filter(([f, t]) => f < t);
  iv.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [f, t] of iv) { if (out.length && f <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], t); else out.push([f, t]); }
  return out;
}
const classesOn = (disp, d) => intervals(disp, d).reduce((a, [f, t]) => a + Math.floor((t - f) / CFG.classMin), 0);

function evaluate(c) {
  const disp = Array.isArray(c.disponibilidad) ? c.disponibilidad.slice(0, 100) : [];
  let weekday = 0; for (let d = 1; d <= CFG.weekdays; d++) weekday += classesOn(disp, d);
  let weekend = 0; for (let d = CFG.weekdays + 1; d <= 7; d++) weekend += classesOn(disp, d);

  const ko = [];
  if (!CFG.acceptNonNative.includes(c.nivel)) ko.push("nivel");
  if (c.ele === "ninguna") ko.push("ele");
  if (c.autonomo === "no") ko.push("autonomo");
  if (c.tarifa === "no") ko.push("tarifa");
  if (![1, 2, 3, 4, 5, 6, 7].some((d) => intervals(disp, d).some(([f, t]) => t - f >= 60))) ko.push("franjas");

  const W = CFG.weights, b = {};
  const n = Math.min(weekday, { "1-2": 2, "3-5": 5, "6-8": 8, "8+": 10 }[c.volumen] || 0);
  b.clases = W.slots * Math.min(1, n / CFG.slotsForFull);
  b.clientes = { regular: W.clientes, algunos: W.clientes / 2 }[c.clientes] || 0;
  b.corporativo = { varios: W.corporativo, alguna: W.corporativo / 2 }[c.corporativo] || 0;
  const expOk = !(c.ele === "experiencia" && !["5-10", "10+"].includes(c.anos));
  b.formacion = expOk ? ({ master: W.ele, curso: W.ele * 0.6, grado: W.ele * 0.6, experiencia: W.ele * 0.6 }[c.ele] || 0) : 0;
  b.enlaces = /^https?:\/\/\S+\.\S+/.test(str(c.enlaces)) ? W.enlaces : 0;
  b.anos = { "2-3": 2, "3-5": 5, "5-10": 10, "10+": W.anos }[c.anos] || 0;
  b.niveles = Math.min(W.niveles, arr(c.niveles).length);
  const main = c.idioma_ensena, bridge = main === "Inglés" ? "Español" : "Inglés";
  const L = [...new Set(arr(c.idiomas).concat(arr(c.idioma_extra)))].filter((x) => x !== main);
  const extra = str(c.idiomas_otros, 200).split(/[,;\/]| y | and | i /i).map((x) => x.trim()).filter((x) => x.length > 2 && !/^(no|ninguno|ninguna|nada|-+)$/i.test(x)).length;
  b.idiomas = Math.min(W.idiomas, (L.includes(bridge) ? 6 : 0) + Math.min(4, (L.filter((x) => x !== bridge).length + extra) * 2));
  b.online = (c.online === "si" ? W.online / 2 : 0) + (arr(c.tools).length ? W.online / 2 : 0);
  b.nivel = c.nivel === "C2" ? W.nivel : 0;
  b.dele = c.dele === "si" ? W.dele : 0;
  Object.keys(b).forEach((k) => (b[k] = Math.round(b[k])));
  let total = Object.values(b).reduce((a, x) => a + x, 0);

  const flags = [];
  if (weekday === 0) { flags.push("Solo fin de semana"); total = Math.min(total, 59); }
  if (!expOk) flags.push("Formación por experiencia sin 5+ años");
  if (c.corporativo === "varios" && ["lt2", "2-3"].includes(c.anos)) flags.push("Muchos grupos de empresa con poca experiencia");
  if (c.corporativo === "varios" && !b.enlaces) flags.push("Varios grupos de empresa sin enlaces");
  if (c.clientes === "no" && ["6-8", "8+"].includes(c.volumen)) flags.push("Sin otros clientes y mucho volumen (revisar dependencia)");
  if (c.tarifa === "comentar") flags.push("Quiere comentar la tarifa");
  const oficina = arr(c.zonas).some((z) => z !== "Solo online");
  const modalidad = oficina ? (c.online === "si" ? "oficina+online" : "oficina") : "online";
  return { ko, total, breakdown: b, flags, weekday, weekend, modalidad };
}

const MAIL = {
  es: { s: "Hemos recibido tu candidatura - Linguallogy", b: (n) => `Hola, ${n}:\n\nGracias por tu candidatura para colaborar con Linguallogy. La revisaremos y te responderemos en cualquier caso en los próximos días. Si tu perfil encaja con los grupos actuales, te propondremos una conversación de 15-20 minutos.\n\nSi tienes cualquier duda, responde a este correo.\n\nUn saludo,\nLinguallogy` },
  en: { s: "We've received your application - Linguallogy", b: (n) => `Hi ${n},\n\nThank you for applying to collaborate with Linguallogy. We'll review your application and reply in any case in the coming days. If your profile fits our current groups, we'll suggest a 15-20 minute conversation.\n\nIf you have any questions, just reply to this email.\n\nBest regards,\nLinguallogy` },
  ca: { s: "Hem rebut la teva candidatura - Linguallogy", b: (n) => `Hola, ${n}:\n\nGràcies per la teva candidatura per col·laborar amb Linguallogy. La revisarem i et respondrem en qualsevol cas en els propers dies. Si el teu perfil encaixa amb els grups actuals, et proposarem una conversa de 15-20 minuts.\n\nSi tens qualsevol dubte, respon aquest correu.\n\nSalutacions,\nLinguallogy` },
};

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  let c;
  try { c = await req.json(); } catch { return json(400, { error: "json" }); }

  const nombre = str(c.nombre, 120), email = str(c.email, 200).toLowerCase();
  if (!nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || c.rgpd !== true) return json(400, { error: "invalid" });

  const ev = evaluate(c);
  if (ev.ko.length) return json(422, { error: "requirements" }); // no se guarda nada

  const row = {
    nombre, email, contacto: str(c.contacto, 120), comentario: str(c.comentario, 800),
    lang_form: ["es", "en", "ca"].includes(c.lang_form) ? c.lang_form : "es",
    idioma_ensena: str(c.idioma_ensena, 20), idioma_extra: arr(c.idioma_extra), nivel: str(c.nivel, 5),
    ele: str(c.ele, 20), anos: str(c.anos, 10), autonomo: str(c.autonomo, 20), tarifa: str(c.tarifa, 20),
    disponibilidad: Array.isArray(c.disponibilidad) ? c.disponibilidad.slice(0, 100) : [],
    clases_posibles: ev.weekday, clases_finde: ev.weekend, volumen: str(c.volumen, 10), zonas: arr(c.zonas),
    clientes: str(c.clientes, 20), corporativo: str(c.corporativo, 20), niveles: arr(c.niveles), online: str(c.online, 10),
    tools: arr(c.tools), idiomas: arr(c.idiomas), idiomas_otros: str(c.idiomas_otros, 200),
    b2c: str(c.b2c, 10), b2c_tarifa: c.b2c === "si" && +c.b2c_tarifa > 0 ? +c.b2c_tarifa : null,
    dele: str(c.dele, 10), situacion: str(c.situacion, 900), enlaces: str(c.enlaces, 500), fuente: str(c.fuente, 40),
    bolsa: c.bolsa === true, score: ev.total, modalidad: ev.modalidad, desglose: ev.breakdown, flags: ev.flags, estado: "nueva",
  };

  const SB_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const SB_KEY = String(process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!SB_URL || !SB_KEY) { console.error("config: falta SUPABASE_URL o SUPABASE_SERVICE_KEY"); return json(500, { error: "config" }); }
  // Claves nuevas de Supabase (sb_secret_...) van solo en "apikey"; las antiguas (JWT service_role) también en Authorization
  const sbHeaders = { apikey: SB_KEY, "Content-Type": "application/json", Prefer: "return=representation" };
  if (!SB_KEY.startsWith("sb_")) sbHeaders.Authorization = `Bearer ${SB_KEY}`;

  let ins;
  try {
    ins = await fetch(`${SB_URL}/rest/v1/candidaturas`, { method: "POST", headers: sbHeaders, body: JSON.stringify(row) });
  } catch (e) { console.error("supabase: sin conexión", String(e).slice(0, 200)); return json(500, { error: "store" }); }
  if (!ins.ok) {
    // el cuerpo de error de Supabase describe el problema (columna, clave...), no contiene los datos enviados
    const detail = (await ins.text()).slice(0, 300);
    console.error("supabase", ins.status, detail);
    return json(500, { error: "store", status: ins.status });
  }
  const [saved] = await ins.json();

  // Telegram: solo número y puntuación (así lo dice el texto de privacidad)
  try {
    const mark = ev.total >= CFG.passThreshold ? "✅" : ev.total >= 60 ? "👀" : "·";
    const txt = `${mark} Candidatura #${saved.id}: ${ev.total}/100${ev.flags.length ? ` (${ev.flags.length} aviso/s)` : ""}${process.env.ADMIN_URL ? `\n${process.env.ADMIN_URL}` : ""}`;
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: txt, disable_web_page_preview: true }),
    });
  } catch (e) { console.error("telegram"); }

  // Acuse de recibo al candidato
  try {
    const m = MAIL[row.lang_form];
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [email], reply_to: "info@linguallogy.com", subject: m.s, text: m.b(nombre) }),
    });
  } catch (e) { console.error("mail"); }

  return json(200, { ok: true });
};
