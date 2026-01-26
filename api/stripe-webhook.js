import Stripe from "stripe";
import crypto from "crypto";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: { bodyParser: false },
};

// --- helpers ---
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const rawBody = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Error verificando webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ SOLO CUANDO EL PAGO SE COMPLETA
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // ✅ Seguridad extra: solo si está pagado
    if (session.payment_status && session.payment_status !== "paid") {
      console.log("⚠️ checkout.session.completed pero NO paid:", session.payment_status);
      return res.status(200).json({ received: true, skipped: "not_paid" });
    }

    // ===== 1) ENVÍO A MAKE (lo tuyo) =====
    try {
      const MAKE_WEBHOOK_URL =
        "https://hook.eu1.make.com/nz979m4h4wfout74pxgnlhf4ofqfgjhc";

      await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stripe_session_id: session.id,
          email: session.customer_email,
          amount_total: session.amount_total,
          currency: session.currency,
          tarifa: session.metadata?.tarifa || null,
          metadata: session.metadata,
          estado_pago: "PAGADO",
        }),
      });

      console.log("✅ Evento enviado a Make correctamente");
    } catch (error) {
      console.error("❌ Error enviando a Make:", error);
    }

    // ===== 2) META CAPI PURCHASE (server-side, a prueba de Safari/Opera) =====
    try {
      const PIXEL_ID = process.env.META_PIXEL_ID;
      const ACCESS_TOKEN = process.env.META_CAPI_TOKEN;

      if (!PIXEL_ID || !ACCESS_TOKEN) {
        console.warn("⚠️ Falta META_PIXEL_ID o META_CAPI_TOKEN, salto CAPI Purchase");
      } else {
        const amountTotal = safeNumber(session.amount_total, 0); // céntimos
        const value = amountTotal / 100;
        const currency = String(session.currency || "eur").toUpperCase();

        // ✅ Dedupe estable:
        // - si viene event_id desde /api/payment -> úsalo
        // - si no, usa algo fijo (session.id) para que no cambie con retries
        const eventId = (session.metadata?.event_id || `purchase_${session.id}`).toString();

        // ✅ Email hash (mejora matching)
        const email = normalizeEmail(session.customer_email);
        const em = email ? sha256(email) : undefined;

        const fbp = session.metadata?.fbp || undefined;
        const fbc = session.metadata?.fbc || undefined;

        // ✅ URL estable (si en metadata vino vacío, fallback)
        const siteUrl = (process.env.SITE_URL || "").trim();
        const fallbackUrl = siteUrl
          ? (siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`) + "/success.html"
          : "";
        const eventSourceUrl = session.metadata?.event_source_url || fallbackUrl;

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
              },

              custom_data: {
                currency,
                value,
                order_id: session.id,
                content_name: "Pedido LIRYA",
                content_category: "Canción personalizada",
                tarifa: session.metadata?.tarifa || undefined,
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

  return res.status(200).json({ received: true });
}
