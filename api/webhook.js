import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Firma Stripe inválida:", err.message);
    return res.status(400).send("Webhook Error");
  }

  // ✅ Solo enviamos a Make el evento de pago completado
  if (event.type === "checkout.session.completed") {
    console.log("💳 Pago recibido. Make se encargará del resto.");

    // Aquí ya no hace falta enviar nada a mano. 
    // Stripe ya envía la señal al Webhook que configuramos en Make.
    return res.status(200).json({ status: "success", message: "Processed by Make" });
  }

  return res.status(200).json({ received: true });
}
