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
  console.log("🔔 Webhook recibido");

  if (req.method !== "POST") {
    console.log("❌ Método no permitido");
    return res.status(405).send("Method Not Allowed");
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
    console.error("❌ Error validando firma Stripe:", err.message);
    return res.status(400).send("Webhook Error");
  }

  console.log("✅ Evento Stripe válido:", event.type);

  // SOLO nos interesa checkout.session.completed
  if (event.type !== "checkout.session.completed") {
    console.log("ℹ️ Evento ignorado");
    return res.json({ ignored: true });
  }

  const session = event.data.object;
  const metadata = session.metadata || {};

  const customerEmail =
    session.customer_details?.email ||
    session.customer_email ||
    metadata.email ||
    null;

  console.log("🧾 METADATA:", metadata);
  console.log("📩 EMAIL CLIENTE:", customerEmail);
  console.log("🆔 SESSION ID:", session.id);

  /* ================= EMAIL INTERNO ================= */

  try {
    console.log("📤 Enviando email interno...");

    await resend.emails.send({
      from: "Lirya <onboarding@resend.dev>",
      to: "proyectosbily@gmail.com",
      subject: "🆕 Nuevo pedido – Canción personalizada",
      html: `
        <h2>🆕 NUEVO PEDIDO</h2>

        <p><strong>Email cliente:</strong> ${customerEmail || "No indicado"}</p>
        <p><strong>Tarifa:</strong> ${metadata.tarifa || "-"}</p>

        <hr>

        <p><strong>Destinatario:</strong> ${metadata.recipient_name || "-"}</p>
        <p><strong>Quien regala:</strong> ${metadata.your_name || "-"}</p>
        <p><strong>Relación:</strong> ${metadata.relationship || "-"}</p>

        <hr>

        <p><strong>Dedicatoria:</strong><br>${metadata.dedication || "-"}</p>

        <hr>

        <p><small>Session ID: ${session.id}</small></p>
      `,
    });

    console.log("✅ EMAIL INTERNO ENVIADO");
  } catch (err) {
    console.error("❌ ERROR EN EMAIL INTERNO:", err);
  }

  /* ================= EMAIL CLIENTE ================= */

  if (customerEmail) {
    try {
      console.log("📤 Enviando email al cliente...");

      await resend.emails.send({
        from: "Lirya <onboarding@resend.dev>",
        to: customerEmail,
        subject: "🎶 Estamos creando tu canción personalizada",
        html: `
          <h2>Gracias por confiar en Lirya 💛</h2>
          <p>Hemos recibido tu pedido correctamente.</p>
          <p>Te avisaremos cuando tu canción esté lista.</p>
          <p><strong>— Equipo Lirya 🎵</strong></p>
        `,
      });

      console.log("✅ EMAIL CLIENTE ENVIADO");
    } catch (err) {
      console.error("❌ ERROR EMAIL CLIENTE:", err);
    }
  } else {
    console.warn("⚠️ No hay email de cliente");
  }

  console.log("✅ Webhook procesado correctamente");
  return res.json({ received: true });
}
