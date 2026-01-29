import Stripe from "stripe";
import crypto from "crypto";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
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
  // Vercel / proxies
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) ? String(req.socket.remoteAddress) : "";
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

  if (envUrl) {
    return envUrl.startsWith("http") ? envUrl : `https://${envUrl}`;
  }
  if (host) return `${proto}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

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
    console.error("❌ Error verificando webhook:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || err}`);
  }

  // Respondemos siempre 200 al final para que Stripe no reintente por fallos internos tuyos
  try {
    // ✅ SOLO cuando el pago se completa
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Seguridad extra: solo si está pagado
      if (session.payment_status && session.payment_status !== "paid") {
        console.log("⚠️ checkout.session.completed pero NO paid:", session.payment_status);
        return res.status(200).json({ received: true, skipped: "not_paid" });
      }

      const baseUrl = buildBaseUrl(req);
      const fallbackSuccessUrl = baseUrl ? `${baseUrl}/success.html` : "";

      // Datos base
      const amountTotal = safeNumber(session.amount_total, 0); // céntimos
      const value = amountTotal / 100;
      const currency = String(session.currency || "eur").toUpperCase();

      // ✅ Dedupe Purchase estable:
      // - si viene event_id desde /api/payment -> úsalo
      // - si no, usa session.id (estable)
      const eventId = String(session.metadata?.event_id || `purchase_${session.id}`);

      // Matching extra
      const email = normalizeEmail(session.customer_email);
      const em = email ? sha256(email) : undefined;

      const fbp = session.metadata?.fbp || undefined;
      const fbc = session.metadata?.fbc || undefined;

      const clientIp = getClientIp(req) || undefined;
      const clientUa = (req.headers["user-agent"] || "").toString() || undefined;

      // URL de fuente (para coherencia)
      const eventSourceUrl =
        String(session.metadata?.event_source_url || "").trim() ||
        fallbackSuccessUrl ||
        undefined;

      const tarifa = session.metadata?.tarifa || null;

      // ===== 1) ENVÍO A MAKE (tu flujo) =====
      // ⚠️ Nota: Stripe puede reintentar eventos.
      // Si Make te duplica registros, usa `event.id` en Make como clave idempotente.
      try {
        const MAKE_WEBHOOK_URL =
          "https://hook.eu1.make.com/nz979m4h4wfout74pxgnlhf4ofqfgjhc";

        await fetch(MAKE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stripe_event_id: event.id, // ✅ útil para dedupe en Make
            stripe_session_id: session.id,
            email: session.customer_email,
            amount_total: session.amount_total,
            currency: session.currency,
            tarifa,
            metadata: session.metadata,
            estado_pago: "PAGADO",
          }),
        });

        console.log("✅ Evento enviado a Make correctamente");
      } catch (error) {
        console.error("❌ Error enviando a Make:", error);
      }

      // ===== 2) META CAPI PURCHASE (server-side) =====
      try {
        const PIXEL_ID = process.env.META_PIXEL_ID;
        const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

        if (!PIXEL_ID || !ACCESS_TOKEN) {
          console.warn("⚠️ Falta META_PIXEL_ID o META_CAPI_TOKEN, salto CAPI Purchase");
        } else {
          const payload = {
            data: [
              {
                event_name: "Purchase",
                event_time: Math.floor(Date.now() / 1000),
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

    // (Opcional) puedes manejar aquí otros eventos si algún día lo necesitas
    // else if (event.type === "checkout.session.expired") { ... }

    return res.status(200).json({ received: true });
  } catch (e) {
    // Aunque falle algo interno, devuelve 200 para evitar reintentos infinitos
    console.error("❌ Webhook handler error:", e);
    return res.status(200).json({ received: true, warning: "handler_error" });
  }
}
