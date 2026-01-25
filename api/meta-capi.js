export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

  if (!PIXEL_ID || !ACCESS_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "Missing META_PIXEL_ID or META_CAPI_TOKEN env vars"
    });
  }

  const body = req.body || {};
  const event_name = body.event_name;
  const event_id = body.event_id;
  const event_time = body.event_time || Math.floor(Date.now() / 1000);
  const custom_data = body.custom_data || {};
  const event_source_url = body.event_source_url || "";
  const action_source = body.action_source || "website";

  // opcional
  const fbp = body.fbp;
  const fbc = body.fbc;

  if (!event_name || !event_id) {
    return res.status(400).json({ ok: false, error: "Missing event_name or event_id" });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "";

  const ua = req.headers["user-agent"] || "";

  // cookies si existen
  const cookie = req.headers.cookie || "";
  const fbpMatch = cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
  const fbcMatch = cookie.match(/(?:^|;\s*)_fbc=([^;]+)/);

  const payload = {
    data: [
      {
        event_name,
        event_time,
        event_id,
        action_source,
        event_source_url,
        user_data: {
          client_ip_address: ip,
          client_user_agent: ua,
          fbp: (fbp || (fbpMatch ? decodeURIComponent(fbpMatch[1]) : undefined)) || undefined,
          fbc: (fbc || (fbcMatch ? decodeURIComponent(fbcMatch[1]) : undefined)) || undefined,
        },
        custom_data
      }
    ]
  };

  const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await r.json();

  if (!r.ok) {
    return res.status(500).json({ ok: false, meta: data });
  }

  return res.status(200).json({ ok: true, meta: data });
}
