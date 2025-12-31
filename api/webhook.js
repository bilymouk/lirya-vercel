import Stripe from "stripe";
import { Resend } from "resend";
import getRawBody from "raw-body";

export const config = {
  api: {
    bodyParser: false, // ⛔ obligatorio para Stripe
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
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
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log("✅ EVENTO STRIPE REAL:", event.type);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const metadata = session.metadata || {};

    console.log("🧾 METADATA RECIBIDA:", metadata);

    await resend.emails.send({
      from: "Lirya <onboarding@resend.dev>",
      to: "proyectosbily@gmail.com",
      subject: "🆕 Nuevo pedido – Canción personalizada",
      html: `
        <h2>Nuevo pedido</h2>
        <p><strong>Destinatario:</strong> ${metadata.recipient_name}</p>
        <p><strong>Relación:</strong> ${metadata.relationship}</p>
        <p><strong>Tarifa:</strong> ${metadata.tarifa}</p>
        <p><strong>Emoción:</strong> ${metadata.emotion}</p>
        <p><strong>Estilo:</strong> ${metadata.song_style}</p>
        <p><strong>Idioma:</strong> ${metadata.language}</p>
        <p><strong>Email cliente:</strong> ${session.customer_details?.email}</p>
      `,
    });

    console.log("✅ EMAIL ENVIADO");
  }

  res.json({ received: true });
}

