import { Resend } from "resend";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const event = req.body;

    console.log("📩 Webhook recibido:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const data = session.metadata || {};

      console.log("🧾 METADATA:", data);

      await resend.emails.send({
        from: "Lirya <onboarding@resend.dev>",
        to: "proyectosbily@gmail.com",
        subject: "🎵 Nuevo pedido Lirya",
        html: `
          <h2>Nuevo pedido recibido</h2>
          <pre>${JSON.stringify(data, null, 2)}</pre>
        `,
      });

      console.log("✅ Email enviado correctamente");
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ Error webhook:", error);
    return res.status(500).json({ error: error.message });
  }
}

