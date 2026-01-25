export default async function handler(req, res) {
  // ===== CORS =====
  const allowedOrigins = [
    "https://www.lirya.studio",
    "https://lirya.studio",
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Solo POST
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

  const {
    event_name,
    event_id, // IMPORTANT: lo usaremos para deduplicar con Pixel
    custom_data = {},
    event_source_url,
    fbp,
    fbc,
    test_event_code, // <- opcional: para Test Events
  } = req.body || {};

  if (!event_name || !event_id) {
    return res.status(400).json({ ok: false, error: "Missing event_name or event_id" });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "";

  const ua = req.headers["user-agent"] || "";

  const payload = {
    data: [
      {
        event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id,
        action_source: "website",
        event_source_url: event_source_url || "https://www.lirya.studio/",
        user_data: {
          client_ip_address: ip,
          client_user_agent: ua,
          // Si no existen, no los mandamos (Meta lo admite así)
          ...(fbp ? { fbp } : {}),
          ...(fbc ? { fbc } : {}),
        },
        custom_data,
      },
    ],
    ...(test_event_code ? { test_event_code } : {}),
  };

  const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const meta = await r.json();

    // Si Meta devuelve error, lo reflejamos con status real
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, meta });
    }

    return res.status(200).json({ ok: true, meta });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Fetch to Meta failed", detail: String(e) });
  }
}
