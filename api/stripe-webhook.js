import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

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

    try {
      const MAKE_WEBHOOK_URL =
        "https://hook.eu1.make.com/313f6hmo9rsa3olwmebih2ryn4fkfdoe";

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
  }

  res.status(200).json({ received: true });
}
