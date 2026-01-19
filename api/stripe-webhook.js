import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

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
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // ✅ Solo si está pagado de verdad
      if (session.payment_status !== "paid") {
        console.log("ℹ️ Session completed but not paid:", {
          sessionId: session.id,
          status: session.payment_status,
        });
        return res.status(200).json({ received: true, ignored: true });
      }

      const MAKE_WEBHOOK_URL = (process.env.MAKE_WEBHOOK_URL_PAID || "").trim();
      if (!MAKE_WEBHOOK_URL) {
        console.error("❌ Falta MAKE_WEBHOOK_URL_PAID en env");
        // 500 => Stripe reintenta (no pierdes el evento)
        return res.status(500).send("Server misconfigured");
      }

      // ✅ Idempotencia: manda event.id para dedupe en Make/Airtable
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

      const r = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        console.error("❌ Make no OK:", r.status, t);
        // 500 => Stripe reintenta
        return res.status(500).send("Make webhook failed");
      }

      console.log("✅ Pago procesado y enviado a Make:", {
        eventId: event.id,
        sessionId: session.id,
      });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Error procesando webhook:", err?.message || err);
    return res.status(500).send("Webhook handler failed");
  }
}
