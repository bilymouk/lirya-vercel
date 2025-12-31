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
    return res.status(400).send("Webhook Error");
  }

  // 👉 SOLO este evento
  if (event.type !== "checkout.session.completed") {
    return res.json({ ignored: true });
  }

  const session = event.data.object;
  const metadata = session.metadata || {};
  const customerEmail =
    session.customer_details?.email || metadata.email || null;

  console.log("🧾 METADATA COMPLETA:", metadata);
  console.log("📩 EMAIL CLIENTE:", customerEmail);

  /* ================= EMAIL INTERNO ================= */

  await resend.emails.send({
    from: "Lirya <onboarding@resend.dev>",
    to: "proyectosbily@gmail.com",
    subject: "🆕 Nuevo pedido – Canción personalizada",
    html: `
      <h2>🆕 NUEVO PEDIDO</h2>

      <p><strong>Destinatario:</strong> ${metadata.recipient_name}</p>
      <p><strong>Quien regala:</strong> ${metadata.your_name}</p>
      <p><strong>Relación:</strong> ${metadata.relationship}</p>

      <hr>

      <p><strong>Cómo se conocieron:</strong><br>${metadata.how_met}</p>
      <p><strong>Momento especial:</strong><br>${metadata.special_moment}</p>
      <p><strong>Por qué ahora:</strong><br>${metadata.reason_now}</p>

      <hr>

      <p><strong>Tres palabras:</strong> ${metadata.three_words}</p>
      <p><strong>Dedicatoria:</strong><br>${metadata.dedication}</p>
      <p><strong>Emoción:</strong> ${metadata.emotion}</p>

      <hr>

      <p><strong>Estilo:</strong> ${metadata.song_style}</p>
      <p><strong>Ritmo:</strong> ${metadata.rhythm}</p>
      <p><strong>Voz:</strong> ${metadata.voice_type}</p>
      <p><strong>Idioma:</strong> ${metadata.language}</p>

      <hr>

      <p><strong>Incluir nombre:</strong> ${metadata.include_name}</p>
      <p><strong>Intensidad:</strong> ${metadata.intensity}</p>
      <p><strong>No mencionar:</strong><br>${metadata.dont_mention}</p>
    `,
  });

  console.log("✅ Email interno enviado");

  /* ================= EMAIL CLIENTE ================= */

  if (customerEmail) {
    await resend.emails.send({
      from: "Lirya <onboarding@resend.dev>",
      to: customerEmail,
      subject: "🎶 Estamos creando tu canción",
      html: `
        <h2>Gracias por confiar en Lirya 💛</h2>
        <p>Hemos recibido tu pedido y ya estamos trabajando en tu canción personalizada.</p>
        <p>Te avisaremos en cuanto esté lista.</p>
        <p><strong>— El equipo de Lirya</strong></p>
      `,
    });

    console.log("✅ Email enviado al cliente");
  }

  res.json({ received: true });
}
