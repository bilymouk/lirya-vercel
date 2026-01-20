import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = {
  api: {
    bodyParser: false, // ⚠️ OBLIGATORIO para Stripe
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    console.error("❌ Falta Stripe-Signature");
    return res.status(400).send("Missing Stripe signature");
  }

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
    // ✅ SOLO cuando el pago se ha completado
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Seguridad extra (Stripe a veces dispara eventos previos)
      if (session.payment_status !== "paid") {
        console.log("ℹ️ Evento recibido pero no pagado:", session.id);
        return res.status(200).json({ ignored: true });
      }

      const MAKE_WEBHOOK_URL_PAID = (process.env.MAKE_WEBHOOK_URL_PAID || "").trim();
      if (!MAKE_WEBHOOK_URL_PAID) {
        console.error("❌ Falta MAKE_WEBHOOK_URL_PAID en variables de entorno");
        // 500 → Stripe reintentará (no se pierde el evento)
        return res.status(500).send("Server misconfigured");
      }

      // 🔑 Payload CLAVE para Make + Airtable
      const payload = {
        stripe_event_id: event.id,          // idempotencia
        stripe_session_id: session.id,      // MATCH con el registro pendiente
        email: session.customer_email,
        amount_total: session.amount_total,
        currency: session.currency,
        tarifa: session.metadata?.tarifa || null,
        metadata: session.metadata || {},
        estado_pago: "PAGADO",
        paid_at: new Date().toISOString(),
      };

      const r = await fetch(MAKE_WEBHOOK_URL_PAID, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        console.error("❌ Make PAGADO no OK:", r.status, t);
        // 500 → Stripe reintentará automáticamente
        return res.status(500).send("Make webhook failed");
      }

      console.log("✅ Pago confirmado y enviado a Make:", session.id);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Error procesando webhook:", err?.message || err);
    return res.status(500).send("Webhook handler failed");
  }
}
