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
      const metadata = session.metadata || {};

      console.log("🧾 METADATA COMPLETA:", metadata);

      /* ===========================
         1️⃣ EMAIL INTERNO (PARA TI)
         =========================== */

      await resend.emails.send({
        from: "Lirya <onboarding@resend.dev>",
        to: "proyectosbily@gmail.com", // ⬅️ TU EMAIL REAL
        subject: "🎵 Nuevo pedido recibido en Lirya",
        html: `
          <h2>Nuevo pedido Lirya</h2>
          <p><strong>Email cliente (Stripe):</strong> ${session.customer_details?.email}</p>
          <pre style="background:#f6f6f6;padding:16px;border-radius:8px;">
${JSON.stringify(metadata, null, 2)}
          </pre>
        `,
      });

      console.log("✅ Email interno enviado");

      /* ==================================
         2️⃣ EMAIL AUTOMÁTICO AL CLIENTE
         ================================== */

      const customerEmail = session.customer_details?.email;

      if (customerEmail) {
        await resend.emails.send({
          from: "Lirya <onboarding@resend.dev>",
          to: customerEmail,
          subject: "🎶 Estamos creando tu canción personalizada",
          html: `
            <h2>Gracias por confiar en Lirya 💛</h2>

            <p>
              Hemos recibido tu historia y ya estamos trabajando en tu canción personalizada.
            </p>

            <p><strong>¿Qué ocurre ahora?</strong></p>
            <ul>
              <li>🎼 Analizamos tu historia</li>
              <li>✍️ Creamos una letra única</li>
              <li>🎧 Producimos tu canción</li>
            </ul>

            <p>
              El tiempo de entrega depende de la tarifa que hayas elegido.
              Te avisaremos en cuanto esté lista.
            </p>

            <p>
              Si necesitas modificar algún detalle, responde a este email.
            </p>

            <p>
              — El equipo de <strong>Lirya</strong>
            </p>
          `,
        });

        console.log("✅ Email enviado al cliente:", customerEmail);
      } else {
        console.warn("⚠️ No se encontró email del cliente en Stripe");
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ Error en webhook:", error);
    return res.status(500).json({ error: error.message });
  }
}
