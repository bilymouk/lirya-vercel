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
    <h2>🆕 NUEVO PEDIDO – CANCIÓN PERSONALIZADA</h2>

    <h3>👤 DATOS PRINCIPALES</h3>
    <p><strong>Destinatario:</strong> ${metadata.recipient_name || "-"}</p>
    <p><strong>Quien regala:</strong> ${metadata.your_name || "-"}</p>
    <p><strong>Relación:</strong> ${metadata.relationship || "-"}</p>
    <p><strong>Tarifa:</strong> ${metadata.tarifa || "-"}</p>
    <p><strong>Email cliente:</strong> ${session.customer_details?.email || "-"}</p>
    <p><strong>WhatsApp:</strong> ${metadata.whatsapp || "-"}</p>
    <p><strong>Teléfono:</strong> ${metadata.phone || "-"}</p>

    <hr>

    <h3>❤️ HISTORIA</h3>
    <p><strong>Cómo se conocieron:</strong><br>${metadata.how_met || "-"}</p>
    <p><strong>Momento especial:</strong><br>${metadata.special_moment || "-"}</p>
    <p><strong>Por qué ahora:</strong><br>${metadata.reason_now || "-"}</p>

    <hr>

    <h3>🎭 EMOCIÓN Y PERSONALIDAD</h3>
    <p><strong>Tres palabras:</strong> ${metadata.three_words || "-"}</p>
    <p><strong>Dedicatoria:</strong><br>${metadata.dedication || "-"}</p>
    <p><strong>Emoción principal:</strong> ${metadata.emotion || "-"}</p>

    <hr>

    <h3>🎵 MÚSICA</h3>
    <p><strong>Estilo:</strong> ${metadata.song_style || "-"}</p>
    <p><strong>Ritmo:</strong> ${metadata.rhythm || "-"}</p>
    <p><strong>Tipo de voz:</strong> ${metadata.voice_type || "-"}</p>
    <p><strong>Idioma:</strong> ${metadata.language || "-"}</p>

    <hr>

    <h3>⚠️ DETALLES FINALES</h3>
    <p><strong>Incluir nombre:</strong> ${metadata.include_name || "-"}</p>
    <p><strong>Intensidad emocional:</strong> ${metadata.intensity || "-"}</p>
    <p><strong>No mencionar:</strong><br>${metadata.dont_mention || "-"}</p>
  `,
});


    console.log("✅ EMAIL ENVIADO");
  }

  res.json({ received: true });
}

