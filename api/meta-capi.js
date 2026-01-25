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

  const {
    event_name,
    event_id,
    custom_data = {},
    event_source_url,
    fbp,
    fbc,
    test_event_code
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
        event_source_url: event_source_url || "",
        user_data: {
          client_ip_address: ip,
          client_user_agent: ua,
          fbp: fbp || undefined,
          fbc: fbc || undefined
        },
        custom_data
      }
    ]
  };

  // ✅ Test Events: Meta exige esto en el body (no dentro del item)
  if (test_event_code) {
    payload.test_event_code = test_event_code;
  }

  const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await r.json();
  return res.status(200).json({ ok: true, meta: data });
}
