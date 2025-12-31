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

  console.log("✅ EVENTO STRIPE:", event.type);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const metadata = session.metadata || {};
    const customerEmail = session.customer_details?.email;

    console.log("🧾 METADATA:", metadata);
    console.log("📧 EMAIL CLIENTE:", customerEmail);

    /* ========= EMAIL INTERNO ========= */
    await resend.emails.send({
      from: "Lirya <onboarding@resend.dev>",
      to: "proyectosbily@gmail.com",
      subject: "🆕 Nuevo pedido – Canción personalizada",
      html: `
        <h2>🆕 NUEVO PEDIDO</h2>
        <p><strong>Destinatario:</strong> ${metadata.recipient_name}</p>
        <p><strong>Quien regala:</strong> ${metadata.your_name}</p>
        <p><strong>Relación:</strong> ${metadata.relationship}</p>
        <p><strong>Tarifa:</strong> ${metadata.tarifa}</p>
        <hr>
        <p><strong>Historia:</strong><br>${metadata.how_met}</p>
        <p><strong>Momento especial:</strong><br>${metadata.special_moment}</p>
        <p><strong>Emoción:</strong> ${metadata.emotion}</p>
        <p><strong>Estilo:</strong> ${metadata.song_style}</p>
        <p><strong>Idioma:</strong> ${metadata.language}</p>
      `,
    });

    console.log("✅ Email interno enviado");

    /* ========= EMAIL AL CLIENTE ========= */
    if (customerEmail) {
      await resend.emails.send({
        from: "Lirya <onboarding@resend.dev>",
        to: customerEmail,
        subject: "🎶 Ya estamos creando tu canción",
        html: `
          <h2>Gracias por confiar en Lirya 💛</h2>
          <p>
            Hemos recibido correctamente tu pedido y <strong>ya estamos trabajando en tu canción personalizada</strong>.
          </p>
          <p>
            Tu historia está en manos de nuestro equipo creativo y será tratada con el máximo cuidado.
          </p>
          <p>
            Te avisaremos en cuanto tu canción esté lista.
          </p>
          <p style="margin-top:30px">
            Con cariño,<br>
            <strong>El equipo de Lirya</strong> 🎶
          </p>
        `,
      });

      console.log("✅ Email enviado al cliente");
    } else {
      console.warn("⚠️ No se encontró email del cliente");
    }
  }

  res.json({ received: true });
}
