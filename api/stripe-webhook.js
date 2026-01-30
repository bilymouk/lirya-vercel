const Stripe = require("stripe");
const crypto = require("crypto");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// En Vercel, para webhooks de Stripe necesitamos el body RAW.
// Este export le dice a Vercel que NO lo convierta a JSON.
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

// ✅ CRÍTICO: raw body como Buffer (firma Stripe correcta)
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

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
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

  // Siempre responde 200 al final para que Stripe no reintente por errores tuyos
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // ✅ Seguridad: solo si está pagado
      if (session.payment_status && session.payment_status !== "paid") {
        console.log("⚠️ completed pero NO paid:", session.payment_status);
      } else {
        const baseUrl = buildBaseUrl(req);

        // Importes
        const amountTotal = safeNumber(session.amount_total, 0);
        const value = amountTotal / 100;
        const currency = String(session.currency || "eur").toUpperCase();

        // ✅ event_id estable para dedupe Meta:
        // 1) metadata.event_id (lo mandas desde /api/payment)
        // 2) client_reference_id (también lo mandas desde /api/payment)
        // 3) fallback estable por sesión
        const eventId = String(
          session.metadata?.event_id ||
            session.client_reference_id ||
            `purchase_${session.id}`
        );

        // ✅ Email robusto (a veces viene aquí)
        const email = normalizeEmail(
          session.customer_email || session.customer_details?.email
        );
        const em = email ? sha256(email) : undefined;

        const fbp = session.metadata?.fbp || undefined;
        const fbc = session.metadata?.fbc || undefined;

        const eventSourceUrl =
          String(session.metadata?.event_source_url || "").trim() ||
          (baseUrl ? `${baseUrl}/` : undefined);

        const tarifa = session.metadata?.tarifa || null;

        // ===== (A) Enviar a Make (opcional) =====
        try {
          const MAKE_WEBHOOK_URL =
            "https://hook.eu1.make.com/nz979m4h4wfout74pxgnlhf4ofqfgjhc";

          // En Vercel normalmente fetch existe. Si no existe, no rompemos.
          if (typeof fetch !== "function") {
            console.warn("⚠️ fetch no disponible en este runtime. Saltando Make.");
          } else {
            await fetch(MAKE_WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                stripe_event_id: event.id, // ✅ dedupe en Make
                stripe_session_id: session.id,
                email: email || (session.customer_email || ""),
                amount_total: session.amount_total,
                currency: session.currency,
                tarifa,
                metadata: session.metadata,
                estado_pago: "PAGADO",
              }),
            });

            console.log("✅ Enviado a Make");
          }
        } catch (e) {
          console.error("⚠️ Make error (no rompemos):", e);
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
                    ...(fbp ? { fbp } : {}),
                    ...(fbc ? { fbc } : {}),
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
        } catch (e) {
          console.error("❌ CAPI error:", e);
        }
      }
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ received: true }));
  } catch (e) {
    console.error("❌ Webhook handler error:", e);

    // ✅ OJO: devolvemos 200 igualmente para que Stripe no reintente por tu error interno
    res.statusCode = 200;
    return res.end(JSON.stringify({ received: true, warning: "handler_error" }));
  }
};
