// /api/meta-capi.js (Vercel Serverless - CommonJS)

const crypto = require("crypto");

const ALLOWED_ORIGINS = [
  "https://lirya.studio",
  "https://www.lirya.studio",
];

// (Opcional) lista blanca de eventos permitidos
const ALLOWED_EVENT_NAMES = new Set([
  "PageView",
  "ViewContent",
  "InitiateCheckout",
  "AddPaymentInfo",
  "Purchase",
  "Lead",
  "CompleteRegistration",
  "Contact",
  "CancelCheckout",
  "AudioExamplePlay",
  "VideoPlay",
]);

// ===== helpers =====
function sha256(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}
function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function normPhone(ph) {
  return String(ph || "").replace(/[^\d+]/g, "").trim();
}
function clampStr(s, max = 2000) {
  const x = String(s || "");
  return x.length > max ? x.slice(0, max) : x;
}

module.exports = async (req, res) => {
  // ===== CORS =====
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, X-Requested-With");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

  // ⚠️ No rompas UX si faltan env vars
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    return res.status(200).json({
      ok: false,
      warning: "Missing META_PIXEL_ID or META_CAPI_TOKEN env vars",
    });
  }

  const body = req.body || {};

  let {
    event_name,
    event_id,
    event_time,
    custom_data = {},
    event_source_url,
    fbp,
    fbc,
    user_data = {},
    action_source,
    test_event_code,
  } = body;

  event_name = clampStr(event_name, 80).trim();
  event_id = clampStr(event_id, 120).trim();
  event_source_url = clampStr(event_source_url, 2000).trim();
  test_event_code = clampStr(test_event_code, 120).trim();

  // ✅ No rompas UX si no hay event_name, pero devuelve warning
  if (!event_name) {
    return res.status(200).json({
      ok: false,
      warning: "Missing event_name",
      received: { event_name, event_id },
    });
  }

  // (Opcional) filtra nombres raros (evita basura)
  if (!ALLOWED_EVENT_NAMES.has(event_name)) {
    // Si prefieres ser ultra-permisivo, comenta este bloque.
    return res.status(200).json({
      ok: false,
      warning: "event_name not allowed",
      received: { event_name, event_id },
    });
  }

  // IP real (Vercel / proxy)
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "");

  const ua = (req.headers["user-agent"] || "").toString();

  // fbp/fbc: acepta ambas formas
  const finalFbp = (user_data && user_data.fbp) || fbp || undefined;
  const finalFbc = (user_data && user_data.fbc) || fbc || undefined;

  // Matching avanzado opcional:
  // si mandas email/phone raw en el futuro, aquí se hashea
  let em = user_data && user_data.em;
  // Si no viene em, intentamos rescatar email_hash de sitios comunes
if (!em) {
  const maybe =
    (body && body.email_hash) ||
    (custom_data && custom_data.email_hash) ||
    (user_data && user_data.email_hash);

  if (maybe && typeof maybe === "string") {
    const h = maybe.trim().toLowerCase();
    // si ya es sha256 (64 hex), lo aceptamos tal cual
    if (/^[a-f0-9]{64}$/.test(h)) em = h;
  }
}
  let ph = user_data && user_data.ph;

  if (!em && user_data && user_data.email) {
    const e = normEmail(user_data.email);
    em = e ? sha256(e) : undefined;
  }
  if (!ph && user_data && user_data.phone) {
    const p = normPhone(user_data.phone);
    ph = p ? sha256(p) : undefined;
  }

  // event_source_url: mejor no vacío
  const finalEventSourceUrl =
    event_source_url ||
    (req.headers.referer ? String(req.headers.referer) : "") ||
    (req.headers.origin ? String(req.headers.origin) : "");

  // Sanitiza custom_data (suave)
  if (custom_data && typeof custom_data === "object") {
    // limit básico por seguridad/ruido
    const safe = {};
    const entries = Object.entries(custom_data).slice(0, 50);
    for (const [k, v] of entries) {
      const kk = clampStr(k, 80);
      if (!kk) continue;
      if (typeof v === "string") safe[kk] = clampStr(v, 500);
      else if (typeof v === "number" || typeof v === "boolean") safe[kk] = v;
      else if (v == null) continue;
      else safe[kk] = clampStr(JSON.stringify(v), 500);
    }
    custom_data = safe;
  } else {
    custom_data = {};
  }

  const payload = {
    data: [
      {
        event_name,
        event_time: Number.isFinite(Number(event_time))
          ? Number(event_time)
          : Math.floor(Date.now() / 1000),

        ...(event_id ? { event_id: String(event_id) } : {}),

        action_source: action_source || "website",
        ...(finalEventSourceUrl ? { event_source_url: finalEventSourceUrl } : {}),

        user_data: {
          ...(ip ? { client_ip_address: ip } : {}),
          ...(ua ? { client_user_agent: ua } : {}),
          ...(finalFbp ? { fbp: finalFbp } : {}),
          ...(finalFbc ? { fbc: finalFbc } : {}),
          ...(em ? { em } : {}),
          ...(ph ? { ph } : {}),
        },

        custom_data: { ...custom_data },
      },
    ],
    ...(test_event_code ? { test_event_code: String(test_event_code) } : {}),
  };

  const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const meta = await r.json().catch(() => ({}));

    // ✅ Responder 200 aunque Meta falle (no rompas tu flow)
    if (!r.ok || meta.error) {
      console.error("❌ Meta CAPI failed:", meta);
      return res.status(200).json({ ok: false, meta });
    }

    return res.status(200).json({ ok: true, meta });
  } catch (err) {
    console.error("❌ Server error calling Meta CAPI:", err);
    return res.status(200).json({
      ok: false,
      error: "Server error calling Meta CAPI",
      details: String(err && err.message ? err.message : err),
    });
  }
};
