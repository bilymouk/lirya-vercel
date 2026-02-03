// /api/meta-capi.js (Vercel Serverless - CommonJS)

const crypto = require("crypto");

const ALLOWED_ORIGINS = [
  "https://lirya.studio",
  "https://www.lirya.studio",
];

// Lista blanca de eventos permitidos
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
  "ScrollDepth25",
  "ScrollDepth50",
  "ScrollDepth75",
  "FormError",
  "PaymentError",
  "ExitIntent",
  "WhatsAppClick",
]);

// ===== RATE LIMITING =====
const rateLimiter = new Map();
const RATE_LIMIT = 30; // requests per window
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip || "unknown";
  const record = rateLimiter.get(key) || { count: 0, resetTime: now + RATE_WINDOW };
  
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_WINDOW;
  } else {
    record.count++;
  }
  
  rateLimiter.set(key, record);
  
  // Cleanup old entries
  if (rateLimiter.size > 1000) {
    for (const [k, v] of rateLimiter.entries()) {
      if (now > v.resetTime) rateLimiter.delete(k);
    }
  }
  
  return record.count <= RATE_LIMIT;
}

// ===== HELPERS =====
function sha256(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normPhone(ph) {
  return String(ph || "").replace(/[^\d+]/g, "").trim();
}

function normName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Remove accents
}

function normCity(city) {
  return String(city || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "");
}

function normZip(zip) {
  return String(zip || "")
    .trim()
    .replace(/[^0-9]/g, "")
    .slice(0, 10);
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, X-Requested-With, X-CSRF-Token");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ===== RATE LIMITING =====
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "");
  
  if (!checkRateLimit(ip)) {
    console.warn(`⚠️ Rate limit exceeded for IP: ${ip}`);
    return res.status(200).json({ 
      ok: false, 
      warning: "Rate limit exceeded" 
    });
  }

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

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

  if (!event_name) {
    return res.status(200).json({
      ok: false,
      warning: "Missing event_name",
      received: { event_name, event_id },
    });
  }

  if (!ALLOWED_EVENT_NAMES.has(event_name)) {
    return res.status(200).json({
      ok: false,
      warning: "event_name not allowed",
      received: { event_name, event_id },
    });
  }

  const ua = (req.headers["user-agent"] || "").toString();

  // ===== IMPROVED USER MATCHING =====
  const finalFbp = (user_data && user_data.fbp) || fbp || undefined;
  const finalFbc = (user_data && user_data.fbc) || fbc || undefined;

  // Email hashing
  let em = user_data && user_data.em;
  if (!em) {
    const maybe =
      (body && body.email_hash) ||
      (custom_data && custom_data.email_hash) ||
      (user_data && user_data.email_hash);

    if (maybe && typeof maybe === "string") {
      const h = maybe.trim().toLowerCase();
      if (/^[a-f0-9]{64}$/.test(h)) em = h;
    }
  }
  if (!em && user_data && user_data.email) {
    const e = normEmail(user_data.email);
    em = e ? sha256(e) : undefined;
  }

  // Phone hashing
  let ph = user_data && user_data.ph;
  if (!ph && user_data && user_data.phone) {
    const p = normPhone(user_data.phone);
    ph = p ? sha256(p) : undefined;
  }

  // Name hashing (first name, last name)
  let fn, ln;
  if (user_data && user_data.first_name) {
    const f = normName(user_data.first_name);
    fn = f ? sha256(f) : undefined;
  }
  if (user_data && user_data.last_name) {
    const l = normName(user_data.last_name);
    ln = l ? sha256(l) : undefined;
  }

  // Location hashing (city, state, zip, country)
  let ct, st, zp, country;
  
  if (user_data && user_data.city) {
    const c = normCity(user_data.city);
    ct = c ? sha256(c) : undefined;
  }
  
  if (user_data && user_data.state) {
    const s = normCity(user_data.state);
    st = s ? sha256(s) : undefined;
  }
  
  if (user_data && user_data.zip) {
    const z = normZip(user_data.zip);
    zp = z ? sha256(z) : undefined;
  }
  
  if (user_data && user_data.country) {
    country = String(user_data.country).trim().toLowerCase().slice(0, 2); // ISO code
  }

  // event_source_url: mejor no vacío
  const finalEventSourceUrl =
    event_source_url ||
    (req.headers.referer ? String(req.headers.referer) : "") ||
    (req.headers.origin ? String(req.headers.origin) : "");

  // Sanitiza custom_data
  if (custom_data && typeof custom_data === "object") {
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

  // Validate event_time
  const now = Math.floor(Date.now() / 1000);
  let finalEventTime = Number.isFinite(Number(event_time)) 
    ? Number(event_time) 
    : now;

  // No puede ser del futuro (max 1 hora adelante)
  if (finalEventTime > now + 3600) {
    finalEventTime = now;
  }

  // No puede ser muy antiguo (max 7 días atrás)
  if (finalEventTime < now - 604800) {
    finalEventTime = now;
  }

  // ===== BUILD PAYLOAD WITH ENHANCED MATCHING =====
  const payload = {
    data: [
      {
        event_name,
        event_time: finalEventTime,

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
          ...(fn ? { fn } : {}),
          ...(ln ? { ln } : {}),
          ...(ct ? { ct } : {}),
          ...(st ? { st } : {}),
          ...(zp ? { zp } : {}),
          ...(country ? { country } : {}),
        },

        custom_data: { ...custom_data },
      },
    ],
    ...(test_event_code ? { test_event_code: String(test_event_code) } : {}),
  };

  // Log for debugging
  console.log(`📤 Sending CAPI event: ${event_name}`, {
    event_id,
    has_email: !!em,
    has_phone: !!ph,
    has_fbp: !!finalFbp,
    has_fbc: !!finalFbc,
    ip: ip ? ip.slice(0, 10) + '...' : 'none',
  });

  const url = `https://graph.facebook.com/v22.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

  // Timeout wrapper
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const meta = await r.json().catch(() => ({}));

    if (!r.ok || meta.error) {
      console.error("❌ Meta CAPI failed:", meta);
      return res.status(200).json({ ok: false, meta });
    }

    console.log(`✅ Meta CAPI ${event_name} sent successfully`);
    return res.status(200).json({ ok: true, meta });
    
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.error("⏱️ Meta CAPI timeout");
      return res.status(200).json({
        ok: false,
        error: "Meta CAPI timeout",
      });
    }

    console.error("❌ Server error calling Meta CAPI:", err);
    return res.status(200).json({
      ok: false,
      error: "Server error calling Meta CAPI",
      details: String(err && err.message ? err.message : err),
    });
  }
};
