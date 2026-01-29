// /api/meta-capi.js (Vercel Serverless - CommonJS)

const crypto = require("crypto");

const ALLOWED_ORIGINS = [
  "https://lirya.studio",
  "https://www.lirya.studio",
];

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

module.exports = async (req, res) => {
  // ===== CORS =====
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

  // ⚠️ NO rompas el frontend por faltar env vars
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    return res.status(200).json({
      ok: false,
      warning: "Missing META_PIXEL_ID or META_CAPI_TOKEN env vars",
    });
  }

  const body = req.body || {};

  const {
    event_name,
    event_id,
    event_time,         // opcional
    custom_data = {},
    event_source_url,
    fbp,
    fbc,
    user_data = {},     // opcional
    action_source,      // opcional
    test_event_code,    // opcional
  } = body;

  // ✅ Recomendación: event_id SIEMPRE que puedas (dedupe),
  // pero si un evento te llega sin event_id, no rompas UX.
  if (!event_name) {
    return res.status(200).json({
      ok: false,
      warning: "Missing event_name",
      received: { event_name, event_id },
    });
  }

  // IP real (Vercel / proxy)
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "");

  const ua = (req.headers["user-agent"] || "").toString();

  // fbp/fbc: acepta de ambas formas
  const finalFbp = user_data.fbp || fbp || undefined;
  const finalFbc = user_data.fbc || fbc || undefined;

  // Matching avanzado opcional:
  // si mandas email/phone raw en el futuro, aquí se hashea
  let em = user_data.em;
  let ph = user_data.ph;

  if (!em && user_data.email) {
    const e = normEmail(user_data.email);
    em = e ? sha256(e) : undefined;
  }
  if (!ph && user_data.phone) {
    const p = normPhone(user_data.phone);
    ph = p ? sha256(p) : undefined;
  }

  // event_source_url: mejor NO vacío
  const finalEventSourceUrl =
    String(event_source_url || "").trim() ||
    (req.headers.referer ? String(req.headers.referer) : "") ||
    (req.headers.origin ? String(req.headers.origin) : "");

  const payload = {
    data: [
      {
        event_name,
        event_time: Number.isFinite(Number(event_time))
          ? Number(event_time)
          : Math.floor(Date.now() / 1000),

        // Si viene event_id, lo usamos; si no, lo omitimos
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

    // ✅ IMPORTANTÍSIMO: responder 200 aunque Meta falle (no rompas tu flow)
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
