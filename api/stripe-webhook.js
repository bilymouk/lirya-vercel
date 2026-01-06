import Stripe from "stripe";
import fetch from "node-fetch";

// Inicializamos Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false, // MUY IMPORTANTE para webhooks
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // Leemos el cuerpo RAW
    const rawBody = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    // Verificamos que el evento viene realmente de Stripe
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Error verificando webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ SOLO actuamos si el pago se ha completado
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    try {
      // 👉 URL DEL WEBHOOK DE MAKE (POST-PAGO)
      const MAKE_WEBHOOK_URL =
        "PEGA_AQUI_TU_WEBHOOK_DE_MAKE_POST_PAGO";

      await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stripe_session_id: session.id,
          email: session.customer_email,
          amount_total: session.amount_total,
          currency: session.currency,
          metadata: session.metadata,
        }),
      });

      console.log("✅ Evento enviado a Make correctamente");
    } catch (error) {
      console.error("❌ Error enviando a Make:", error);
    }
  }

  res.status(200).json({ received: true });
}
