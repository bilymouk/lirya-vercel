// /api/meta-capi.js

import crypto from "crypto";

function sha256(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}
function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function normPhone(ph) {
  return String(ph || "").replace(/[^\d+]/g, "").trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "Missing META_PIXEL_ID or META_CAPI_TOKEN env vars",
    });
  }

  const body = req.body || {};

  const {
    event_name,
    event_id,
    event_time, // opcional
    custom_data = {},
    event_source_url,
    fbp,
    fbc,
    user_data = {},      // soporta user_data
    action_source,       // opcional
    test_event_code,     // test events
  } = body;

  if (!event_name || !event_id) {
    return res.status(400).json({
      ok: false,
      error: "Missing event_name or event_id",
      received: { event_name, event_id },
    });
  }

  // IP real (Vercel / proxy)
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "";

  const ua = (req.headers["user-agent"] || "").toString();

  // fbp/fbc: acepta de ambas formas
  const finalFbp = user_data?.fbp || fbp || undefined;
  const finalFbc = user_data?.fbc || fbc || undefined;

  // ✅ Matching avanzado opcional:
  // - Si en algún momento mandas email/phone raw (NO hash) desde front,
  //   lo hash-eamos aquí (más limpio).
  let em = user_data?.em;
  let ph = user_data?.ph;

  // Si mandas user_data.email o user_data.phone en el futuro:
  if (!em && user_data?.email) {
    const e = normEmail(user_data.email);
    em = e ? sha256(e) : undefined;
  }
  if (!ph && user_data?.phone) {
    const p = normPhone(user_data.phone);
    ph = p ? sha256(p) : undefined;
  }

  // event_source_url: mejor NO mandar vacío
  const finalEventSourceUrl =
  String(event_source_url || "").trim() ||
  (req.headers?.referer ? String(req.headers.referer) : "") ||
  (req.headers?.origin ? String(req.headers.origin) : "");

  const payload = {
    data: [
      {
        event_name,
        event_time: Number.isFinite(Number(event_time))
          ? Number(event_time)
          : Math.floor(Date.now() / 1000),

        event_id,
        action_source: action_source || "website",
        event_source_url: finalEventSourceUrl,

        user_data: {
          // Prioridad: lo que ve el servidor
          client_ip_address: ip || 
          client_user_agent: ua ||
            
          ...(finalFbp ? { fbp: finalFbp } : {}),
          ...(finalFbc ? { fbc: finalFbc } : {}),
          ...(em ? { em } : {}),
          ...(ph ? { ph } : {}),
        },

        custom_data,
      },
    ],
  };

  // Test Events: Meta lo exige a nivel raíz
  if (test_event_code) payload.test_event_code = test_event_code;

  const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok || data?.error) {
      return res.status(500).json({
        ok: false,
        error: "Meta CAPI request failed",
        meta: data,
      });
    }

    return res.status(200).json({ ok: true, meta: data });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Server error calling Meta CAPI",
      details: String(err?.message || err),
    });
  }
}
