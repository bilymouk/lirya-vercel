// /api/stripe-webhook.js
const Stripe = require("stripe");
const crypto = require("crypto");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ===== helpers =====
function sha256(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function safeNumber(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket?.remoteAddress ? String(req.socket.remoteAddress) : "";
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

// ✅ RAW BODY real (Buffer). Stripe lo recomienda así.
async function readRawBodyBuffer(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  // Stripe solo manda POST
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    // Si falta, es que NO viene de Stripe o hay proxy raro
    console.error("❌ Falta stripe-signature header");
    return res.status(400).send("Webhook Error: Missing stripe-signature");
  }

  let event;
  try {
    const rawBody = await readRawBodyBuffer(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Error verificando webhook:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || err}`);
  }

  // ✅ Responder 200 SIEMPRE al final (si algo interno falla, Stripe puede reintentar)
  try {
    // Nos interesa SOLO cuando el checkout se completa
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Extra seguridad: solo si está pagado
      if (session.payment_status && session.payment_status !== "paid") {
        console.log("⚠️ checkout.session.completed pero NO paid:", session.payment_status);
      } else {
        const baseUrl = buildBaseUrl(req);
        const fallbackSuccessUrl = baseUrl ? `${baseUrl}/success.html` : "";

        // Value
        const amountTotal = safeNumber(session.amount_total, 0); // céntimos
        const value = amountTotal / 100;
        const currency = String(session.currency || "eur").toUpperCase();

        // ✅ event_id estable para dedupe (ideal: el que tú guardas en metadata desde /api/payment)
        // - si existe session.metadata.event_id → perfecto
        // - si no → fallback estable
        const eventId = String(session.metadata?.event_id || `purchase_${session.id}`);

        // Matching
        const email = normalizeEmail(session.customer_email);
        const em = email ? sha256(email) : undefined;

        const fbp = session.metadata?.fbp || undefined;
        const fbc = session.metadata?.fbc || undefined;

        const clientIp = getClientIp(req) || undefined;
        const clientUa = (req.headers["user-agent"] || "").toString() || undefined;

        const eventSourceUrl =
          String(session.metadata?.event_source_url || "").trim() ||
          fallbackSuccessUrl ||
          undefined;

        const tarifa = session.metadata?.tarifa || null;

        // ===== 1) ENVÍO A MAKE =====
        // Stripe puede reintentar → dedupe en Make por stripe_event_id
        try {
          const MAKE_WEBHOOK_URL =
            process.env.MAKE_WEBHOOK_URL ||
            "https://hook.eu1.make.com/nz979m4h4wfout74pxgnlhf4ofqfgjhc";

          await fetch(MAKE_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stripe_event_id: event.id, // ✅ dedupe en Make
              stripe_session_id: session.id,
              email: session.customer_email,
              amount_total: session.amount_total,
              currency: session.currency,
              tarifa,
              metadata: session.metadata,
              estado_pago: "PAGADO",
            }),
          });

          console.log("✅ Make OK:", event.id);
        } catch (error) {
          console.error("❌ Error enviando a Make:", error);
        }

        // ===== 2) META CAPI PURCHASE (server-side) =====
        try {
          const PIXEL_ID = process.env.META_PIXEL_ID;
          const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

          if (!PIXEL_ID || !ACCESS_TOKEN) {
            console.warn("⚠️ Falta META_PIXEL_ID o META_CAPI_TOKEN → salto CAPI Purchase");
          } else {
            const payload = {
              data: [
                {
                  event_name: "Purchase",
                  event_time: Number.isFinite(Number(event.created))
                    ? Number(event.created)
                    : Math.floor(Date.now() / 1000),

                  // ✅ clave: esto permite dedupe perfecto
                  event_id: eventId,

                  action_source: "website",
                  event_source_url: eventSourceUrl,

                  user_data: {
                    ...(em ? { em } : {}),
                    ...(fbp ? { fbp } : {}),
                    ...(fbc ? { fbc } : {}),
                    ...(clientIp ? { client_ip_address: clientIp } : {}),
                    ...(clientUa ? { client_user_agent: clientUa } : {}),
                  },

                  custom_data: {
                    currency,
                    value,
                    order_id: session.id,
                    content_name: "Canción personalizada",
                    content_type: "product",
                    plan: tarifa ? String(tarifa) : undefined,
                  },
                },
              ],
            };

            const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

            const r = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

            const meta = await r.json().catch(() => ({}));

            if (!r.ok || meta?.error) {
              console.error("❌ Meta CAPI Purchase falló:", meta);
            } else {
              console.log("✅ Meta CAPI Purchase OK:", meta);
            }
          }
        } catch (err) {
          console.error("❌ Error enviando Meta CAPI Purchase:", err);
        }
      }
    }

    // ✅ 200 SIEMPRE
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("❌ Webhook handler error:", e);
    // aunque falle algo tuyo, devuelve 200 para no reintentos infinitos
    return res.status(200).json({ received: true, warning: "handler_error" });
  }
};
