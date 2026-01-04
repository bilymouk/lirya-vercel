import Stripe from "stripe";
import { Resend } from "resend";
import getRawBody from "raw-body";
import { Redis } from "@upstash/redis";

/* ================= CONFIG ================= */

export const config = {
  api: {
    bodyParser: false,
  },
};

/* ================= CLIENTS ================= */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const resend = new Resend(process.env.RESEND_API_KEY);
const redis = Redis.fromEnv();

/* ================= HANDLER ================= */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const sig = req.headers["stripe-signature"];
  let event;

  /* ================= STRIPE SIGNATURE ================= */

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Stripe signature error:", err.message);
    return res.status(400).send("Webhook Error");
  }

  /* ================= SOLO CHECKOUT COMPLETADO ================= */

  if (event.type !== "checkout.session.completed") {
    return res.json({ ignored: true });
  }

  const eventId = event.id;
  const session = event.data.object;

  /* ================= ANTI DUPLICADOS (REDIS) ================= */

  const redisKey = `stripe:event:${eventId}`;
  const alreadyProcessed = await redis.get(redisKey);

  if (alreadyProcessed) {
    console.warn("⚠️ Evento duplicado ignorado:", eventId);
    return res.json({ duplicate: true });
  }

  await redis.set(redisKey, true, { ex: 60 * 60 * 24 });

  /* ================= DATOS ================= */

  const metadata = session.metadata || {};

  const customerEmail =
    session.customer_details?.email ||
    session.customer_email ||
    metadata.email ||
    null;

  console.log("🆔 EVENT ID:", eventId);
  console.log("📩 EMAIL CLIENTE:", customerEmail);
  console.log("🧾 METADATA:", metadata);

  /* ================= EMAIL INTERNO ================= */

  try {
    await resend.emails.send({
      from: "Lirya <ayuda@lirya.studio>",
      to: "proyectosbily@gmail.com",
      subject: "🆕 Nuevo pedido – Canción personalizada",
      html: `
        <h2>🆕 NUEVO PEDIDO</h2>

        <p><strong>Email cliente:</strong> ${customerEmail || "No indicado"}</p>
        <p><strong>Tarifa:</strong> ${metadata.tarifa || "-"}</p>

        <hr />

        <h3>👤 Datos personales</h3>
        <p><strong>Destinatario:</strong> ${metadata.recipient_name || "-"}</p>
        <p><strong>Quién regala:</strong> ${metadata.your_name || "-"}</p>
        <p><strong>Relación:</strong> ${metadata.relationship || "-"}</p>

        <hr />

        <h3>📖 Historia</h3>
        <p><strong>Cómo se conocieron:</strong><br/>${metadata.how_met || "-"}</p>
        <p><strong>Momento especial:</strong><br/>${metadata.special_moment || "-"}</p>
        <p><strong>Por qué ahora:</strong><br/>${metadata.reason_now || "-"}</p>

        <hr />

        <h3>💬 Mensaje</h3>
        <p><strong>Tres palabras:</strong> ${metadata.three_words || "-"}</p>
        <p><strong>Dedicatoria:</strong><br/>${metadata.dedication || "-"}</p>
        <p><strong>Emoción principal:</strong> ${metadata.emotion || "-"}</p>

        <hr />

        <h3>🎵 Estilo musical</h3>
        <p><strong>Estilo:</strong> ${metadata.song_style || "-"}</p>
        <p><strong>Ritmo:</strong> ${metadata.rhythm || "-"}</p>
        <p><strong>Tipo de voz:</strong> ${metadata.voice_type || "-"}</p>
        <p><strong>Idioma:</strong> ${metadata.language || "-"}</p>

        <hr />

        <h3>⚙️ Detalles finales</h3>
        <p><strong>Incluir nombre:</strong> ${metadata.include_name || "-"}</p>
        <p><strong>Intensidad:</strong> ${metadata.intensity || "-"}</p>
        <p><strong>No mencionar:</strong><br/>${metadata.dont_mention || "-"}</p>

        <hr />

        <p><small>Stripe Event ID: ${eventId}</small></p>
      `,
    });

    console.log("✅ Email interno enviado");
  } catch (err) {
    console.error("❌ Error enviando email interno:", err);
  }

  /* ================= EMAIL CLIENTE ================= */

  if (customerEmail) {
    try {
      await resend.emails.send({
        from: "Lirya <ayuda@lirya.studio>",
        to: customerEmail,
        subject: "🎶 Estamos creando tu canción personalizada",
        html: `
          <h2>Gracias por confiar en Lirya 💛</h2>

          <p>Hemos recibido correctamente tu pedido y ya estamos trabajando en tu canción personalizada.</p>

          <p>Nos tomamos cada historia con mucho cariño y atención al detalle.  
          Te avisaremos en cuanto esté lista ✨</p>

          <p><strong>— El equipo de Lirya 🎵</strong></p>
        `,
      });

      console.log("✅ Email enviado al cliente");
    } catch (err) {
      console.error("❌ Error enviando email al cliente:", err);
    }
  } else {
    console.warn("⚠️ No se encontró email de cliente");
  }

  /* ================= RESPUESTA FINAL ================= */

  return res.status(200).json({ received: true });
}
