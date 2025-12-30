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
      console.log("🧾 EMAIL METADATA:", data.email);

      await resend.emails.send({
        from: "Lirya <onboarding@resend.dev>",
        to: "proyectosbily@gmail.com",
        subject: "🎵 Nuevo pedido Lirya",
        html: `
          <h2>Nuevo pedido recibido</h2>
          <pre>${JSON.stringify(data, null, 2)}</pre>
        `,
      });
      // 📩 Email de confirmación al cliente
if (data.email) {
  await resend.emails.send({
    from: "Lirya <onboarding@resend.dev>",
    to: data.email,
    subject: "🎶 Estamos creando tu canción personalizada",
    html: `
      <h2>Gracias por confiar en Lirya 💛</h2>

      <p>Hemos recibido tu historia y ya estamos trabajando en tu canción personalizada.</p>

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
        Si necesitas modificar algo, responde a este email.
      </p>

      <p>
        — El equipo de <strong>Lirya</strong>
      </p>
    `,
  });

  console.log("✅ Email enviado al cliente:", data.email);
}

      console.log("✅ Email enviado correctamente");
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ Error webhook:", error);
    return res.status(500).json({ error: error.message });
  }
}

