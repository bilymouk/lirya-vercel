import Stripe from "stripe";
import { Resend } from "resend";
import getRawBody from "raw-body";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  let event;

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Error verificando webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // SOLO cuando el pago se completa
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const data = session.metadata;

    try {
      await resend.emails.send({
        from: "Lirya <onboarding@resend.dev>",
        to: "proyectosbily@gmail.com",
        subject: "🎵 Nuevo pedido Lirya",
        html: `
          <h2>Nuevo pedido confirmado</h2>
          <p><strong>Para:</strong> ${data.recipient_name}</p>
          <p><strong>De:</strong> ${data.your_name}</p>
          <p><strong>Relación:</strong> ${data.relationship}</p>
          <p><strong>Tarifa:</strong> ${data.tarifa}€</p>
          <hr />
          <p><strong>Cómo se conocieron:</strong><br>${data.how_met}</p>
          <p><strong>Momento especial:</strong><br>${data.special_moment}</p>
          <p><strong>Palabras clave:</strong> ${data.three_words}</p>
          <p><strong>Estilo:</strong> ${data.song_style}</p>
          <p><strong>Frase:</strong><br>${data.dedication}</p>
          <p><strong>Email cliente:</strong> ${data.email}</p>
          <p><strong>WhatsApp:</strong> ${data.whatsapp}</p>
        `,
      });

      console.log("📩 Email enviado correctamente");
    } catch (emailError) {
      console.error("❌ Error enviando email:", emailError);
    }
  }

  res.json({ received: true });
}

