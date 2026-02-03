const Stripe = require("stripe");
const crypto = require("crypto");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports.config = {
  api: { bodyParser: false },
};

// ===== helpers =====
function sha256(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function normalizePhone(ph) {
  return String(ph || "").replace(/[^\d+]/g, "").trim();
}
function normalizeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function normalizeCity(city) {
  return String(city || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "");
}
function normalizeZip(zip) {
  return String(zip || "")
    .trim()
    .replace(/[^0-9]/g, "")
    .slice(0, 10);
}
function safeNumber(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}
function buildBaseUrl(req) {
  const envUrl = (process.env.SITE_URL || "").trim();

  const proto = (req.headers["x-forwarded-proto"] || "https")
    .toString()
    .split(",")[0]
    .trim();

  const host = (req.headers["x-forwarded-host"] || req.headers.host || "")
    .toString()
    .split(",")[0]
    .trim();

  if (envUrl) return envUrl.startsWith("http") ? envUrl : `https://${envUrl}`;
  if (host) return `${proto}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ===== IDEMPOTENCY (BEST-EFFORT; serverless can't guarantee across instances) =====
const processedEvents = new Set();
const MAX_CACHE_SIZE = 1000;

// ===== RETRY LOGIC FOR META CAPI =====
async function sendMetaCapiWithRetry(payload, url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const meta = await r.json().catch(() => ({}));

      if (r.ok && !meta?.error) {
        console.log(`✅ Meta CAPI Purchase OK (attempt ${attempt})`);
        return { success: true, meta };
      }

      console.warn(`⚠️ Meta CAPI attempt ${attempt} failed:`, meta);

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    } catch (e) {
      console.error(`❌ Meta CAPI attempt ${attempt} error:`, e.message);

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  return { success: false };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.statusCode = 400;
    return res.end("Missing Stripe signature");
  }

  let event;

  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature error:", err?.message || err);
    res.statusCode = 400;
    return res.end(`Webhook Error: ${err?.message || err}`);
  }

  // Idempotency check (best-effort)
  if (processedEvents.has(event.id)) {
    console.log("⚠️ Duplicate webhook ignored:", event.id);
    res.statusCode = 200;
    return res.end(JSON.stringify({ received: true, duplicate: true }));
  }

  processedEvents.add(event.id);

  // Cleanup cache if too large
  if (processedEvents.size > MAX_CACHE_SIZE) {
    const entries = Array.from(processedEvents);
    processedEvents.clear();
    entries.slice(-500).forEach((id) => processedEvents.add(id));
  }

  // Filtro de evento
  const HANDLED_EVENTS = new Set([
    "checkout.session.completed",
    "checkout.session.expired",
  ]);

  if (!HANDLED_EVENTS.has(event.type)) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ received: true, ignored: event.type }));
  }

  const session = event.data.object;

  try {
    // Handle different event types
    if (event.type === "checkout.session.expired") {
      console.log("⏰ Session expired:", session.id);

      // Opcional: avisar a Make que se expiró
      try {
        const MAKE_WEBHOOK_URL =
          process.env.MAKE_WEBHOOK_CONFIRMED_URL || process.env.MAKE_WEBHOOK_URL;

        if (MAKE_WEBHOOK_URL && typeof fetch === "function") {
          await fetch(MAKE_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stripe_event_id: event.id,
              stripe_session_id: session.id,
              estado_pago: "EXPIRADO",
            }),
          });
        }
      } catch (e) {
        console.error("⚠️ Make error (expired):", e);
      }

      res.statusCode = 200;
      return res.end(JSON.stringify({ received: true, expired: true }));
    }

    // checkout.session.completed
    if (session.payment_status && session.payment_status !== "paid") {
      console.log("⚠️ completed pero NO paid:", session.payment_status);
      res.statusCode = 200;
      return res.end(JSON.stringify({ received: true, not_paid: true }));
    }

    const baseUrl = buildBaseUrl(req);
    const metadata = session.metadata || {};

    // Importes
    const amountTotal = safeNumber(session.amount_total, 0);
    const value = amountTotal / 100;

    // ✅ currency en mayúsculas (estándar Meta)
    const currency = String(session.currency || "eur").toUpperCase();

    // ✅ event_id estable (mejor fallback)
    const eventId = String(metadata.event_id || session.id || event.id);

    // Email robusto
    const email = normalizeEmail(
      session.customer_email || session.customer_details?.email
    );
    const em = email ? sha256(email) : undefined;

    // Phone
    const phone = metadata.phone || session.customer_details?.phone;
    const ph = phone ? sha256(normalizePhone(phone)) : undefined;

    // Nombre
    const yourName = metadata.your_name;
    const fn = yourName ? sha256(normalizeName(yourName)) : undefined;

    // Location
    const address = session.customer_details?.address || {};
    const ct = address.city ? sha256(normalizeCity(address.city)) : undefined;
    const zp = address.postal_code ? sha256(normalizeZip(address.postal_code)) : undefined;

    // ✅ country NO hasheado (ISO 2 letras)
    const country = address.country
      ? String(address.country).trim().toLowerCase().slice(0, 2)
      : undefined;

    const fbp = metadata.fbp || undefined;
    const fbc = metadata.fbc || undefined;

    const eventSourceUrl =
      String(metadata.event_source_url || "").trim() ||
      (baseUrl ? `${baseUrl}/` : undefined);

    const tarifa = metadata.tarifa || null;

    console.log("💰 PURCHASE EVENT:", {
      session_id: session.id,
      event_id: eventId,
      email: email ? email.slice(0, 5) + "***" : "none",
      amount: value,
      currency,
      tarifa,
      has_fbp: !!fbp,
      has_fbc: !!fbc,
      has_phone: !!ph,
      has_name: !!fn,
      has_city: !!ct,
      has_country: !!country,
      timestamp: new Date(event.created * 1000).toISOString(),
    });

    // ===== (A) Enviar a Make (opcional) =====
    try {
      const MAKE_WEBHOOK_URL =
        process.env.MAKE_WEBHOOK_CONFIRMED_URL ||
        "https://hook.eu1.make.com/nz979m4h4wfout74pxgnlhf4ofqfgjhc";

      if (typeof fetch !== "function") {
        console.warn("⚠️ fetch no disponible en este runtime. Saltando Make.");
      } else {
        const makeResponse = await fetch(MAKE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stripe_event_id: event.id,
            stripe_session_id: session.id,
            email: email || (session.customer_email || ""),
            amount_total: session.amount_total,
            currency: session.currency,
            tarifa,
            metadata: session.metadata,
            estado_pago: "PAGADO",
          }),
        });

        if (!makeResponse.ok) {
          console.error("⚠️ Make webhook failed:", {
            status: makeResponse.status,
            statusText: makeResponse.statusText,
            session_id: session.id,
          });
        } else {
          console.log("✅ Enviado a Make");
        }
      }
    } catch (e) {
      console.error("❌ Make error:", {
        error: e.message,
        session_id: session.id,
      });
    }

    // ===== (B) META CAPI Purchase (SERVER-SIDE) =====
    try {
      const PIXEL_ID = process.env.META_PIXEL_ID;
      const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

      if (!PIXEL_ID || !ACCESS_TOKEN) {
        console.warn("⚠️ Falta META_PIXEL_ID o META_CAPI_TOKEN");
      } else if (typeof fetch !== "function") {
        console.warn("⚠️ fetch no disponible en este runtime. Saltando Meta CAPI.");
      } else {
        const payload = {
          data: [
            {
              event_name: "Purchase",
              event_time: Number.isFinite(Number(event.created))
                ? Number(event.created)
                : Math.floor(Date.now() / 1000),

              event_id: eventId,
              action_source: "website",
              event_source_url: eventSourceUrl,

              user_data: {
                ...(em ? { em } : {}),
                ...(ph ? { ph } : {}),
                ...(fn ? { fn } : {}),
                ...(ct ? { ct } : {}),
                ...(zp ? { zp } : {}),
                ...(country ? { country } : {}), // ✅ NO hash
                ...(fbp ? { fbp } : {}),
                ...(fbc ? { fbc } : {}),
              },

              custom_data: {
                currency, // ✅ EUR
                value,
                order_id: session.id,
                content_name: "Canción personalizada",
                content_type: "product",
                content_ids: [tarifa || "default"],
                num_items: 1,
                plan: tarifa ? String(tarifa) : undefined,
                recipient_name: metadata.recipient_name || undefined,
                song_style: metadata.song_style || undefined,
                relationship: metadata.relationship || undefined,
                payment_method: session.payment_method_types?.[0] || "card",
              },
            },
          ],
        };

        const url = `https://graph.facebook.com/v22.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

        const result = await sendMetaCapiWithRetry(payload, url);

        if (!result.success) {
          console.error("❌ Meta CAPI failed after 3 attempts");
        }
      }
    } catch (e) {
      console.error("❌ CAPI error:", e);
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ received: true }));
  } catch (e) {
    console.error("❌ Webhook handler error:", e);

    res.statusCode = 500;
    return res.end(JSON.stringify({ received: true, warning: "handler_error" }));
  }
};

