import Stripe from "stripe";
import getRawBody from "raw-body";
import { fetch as undiciFetch } from "undici";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

function getFetch() {
  return typeof globalThis.fetch === "function" ? globalThis.fetch : undiciFetch;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing Stripe-Signature");

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Firma Stripe inválida:", err?.message || err);
    return res.status(400).send("Webhook Error");
  }

  try {
    const relevant =
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"; // opcional, pero pro

    if (relevant) {
      const session = event.data.object;

      if (session.payment_status !== "paid") {
        console.log("ℹ️ Session not paid:", {
          sessionId: session.id,
          status: session.payment_status,
          type: event.type,
        });
        return res.status(200).json({ received: true, ignored: true });
      }

      const MAKE_WEBHOOK_URL = (process.env.MAKE_WEBHOOK_URL_PAID || "").trim();
      if (!MAKE_WEBHOOK_URL) {
        console.error("❌ Falta MAKE_WEBHOOK_URL_PAID en env");
        return res.status(500).send("Server misconfigured");
      }

      const payload = {
        stripe_event_id: event.id,
        stripe_session_id: session.id,
        email: session.customer_email,
        amount_total: session.amount_total,
        currency: session.currency,
        tarifa: session.metadata?.tarifa || null,
        metadata: session.metadata || {},
        estado_pago: "PAGADO",
      };

      const doFetch = getFetch();
      const r = await doFetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        console.error("❌ Make no OK:", r.status, t);
        return res.status(500).send("Make webhook failed");
      }

      console.log("✅ Pago enviado a Make:", { eventId: event.id, sessionId: session.id });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Error procesando webhook:", err?.message || err);
    return res.status(500).send("Webhook handler failed");
  }
}
