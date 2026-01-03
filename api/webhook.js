import Stripe from "stripe";
import { Resend } from "resend";
import getRawBody from "raw-body";
import { Redis } from "@upstash/redis";

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const redis = Redis.fromEnv();

export default async function handler(req, res) {
  console.log("🔥 WEBHOOK EJECUTADO");

  if (req.method !== "POST") {
    console.warn("⛔ Método no permitido");
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

  console.log("📦 EVENT TYPE:", event.type);

  // 🔒 SOLO ESTE EVENTO
  if (event.type !== "checkout.session.completed") {
    console.log("↩️ Evento ignorado");
    return res.json({ ignored: true });
  }

  const eventId = event.id;
  const session = event.data.object;

  console.log("🆔 EVENT ID:", eventId);

  // 🔐 ANTIDUPLICADOS (EVENTO, NO SESSION)
  const redisKey = `stripe:event:${eventId}`;
  const alreadyProcessed = await redis.get(redisKey);

  if (alreadyProcessed) {
    console.warn("⚠️ Evento duplicado bloqueado:", eventId);
    return res.json({ duplicate: true });
  }

  await redis.set(redisKey, "true", { ex: 60 * 60 * 24 });
  console.log("🧠 Evento marcado como procesado en Redis");

  // 📋 DATOS
  const metadata = session.metadata || {};
  const customerEmail =
    session.customer_details?.email ||
    session.customer_email ||
    metadata.email ||
    null;

  console.log("🧾 METADATA:", metadata);
  console.log("📩 EMAIL CLIENTE:", customerEmail);

  /* ================= EMAIL INTERNO ================= */

  try {
    console.log("📤 Enviando email interno...");

    await resend.emails.send({
      from: "Lirya <ayuda@lirya.studio>",
      to: "proyectosbily@gmail.com",
      subject: "🆕 Nuevo pedido – Canción personalizada",
      html: `
        <h2>🆕 NUEVO PEDIDO</h2>
        <p><strong>Email cliente:</strong> ${customerEmail || "No indicado"}</p>
        <p><strong>Tarifa:</strong> ${metadata.tarifa || "-"}</p>
        <hr />
        <p><strong>Destinatario:</strong> ${metadata.recipient_name || "-"}</p>
        <p><strong>Quien regala:</strong> ${metadata.your_name || "-"}</p>
        <p><strong>Relación:</strong> ${metadata.relationship || "-"}</p>
        <hr />
        <p><strong>Cómo se conocieron:</strong><br />${metadata.how_met || "-"}</p>
        <p><strong>Momento especial:</strong><br />${metadata.special_moment || "-"}</p>
        <p><strong>Por qué ahora:</strong><br />${metadata.reason_now || "-"}</p>
        <hr />
        <p><strong>Dedicatoria:</strong><br />${metadata.dedication || "-"}</p>
        <p><strong>Emoción:</strong> ${metadata.emotion || "-"}</p>
        <hr />
        <p><small>Stripe Event ID: ${eventId}</small></p>
      `,
    });

    console.log("✅ EMAIL INTERNO ENVIADO");
  } catch (err) {
    console.error("❌ ERROR EMAIL INTERNO:", err);
  }

  /* ================= EMAIL CLIENTE ================= */

  if (customerEmail) {
    try {
      console.log("📤 Enviando email al cliente...");

      await resend.emails.send({
        from: "Lirya <ayuda@lirya.studio>",
        to: customerEmail,
        subject: "🎶 Estamos creando tu canción personalizada",
        html: `
          <h2>Gracias por confiar en Lirya 💛</h2>
          <p>Hemos recibido tu pedido y ya estamos trabajando en tu canción.</p>
          <p>Te avisaremos en cuanto esté lista.</p>
          <p><strong>— El equipo de Lirya 🎵</strong></p>
        `,
      });

      console.log("✅ EMAIL CLIENTE ENVIADO");
    } catch (err) {
      console.error("❌ ERROR EMAIL CLIENTE:", err);
    }
  } else {
    console.warn("⚠️ No hay email de cliente");
  }

  return res.json({ received: true });
}
