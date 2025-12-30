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

      /* =================================================
         1️⃣ EMAIL INTERNO – BRIEF CREATIVO (PARA TI)
         ================================================= */

      const emailInterno = `
<h2>🆕 NUEVO PEDIDO – CANCIÓN PERSONALIZADA</h2>

<h3>👤 DATOS PRINCIPALES</h3>
<p><strong>Nombre del destinatario:</strong> ${metadata.recipient_name || "-"}</p>
<p><strong>Nombre de quien regala:</strong> ${metadata.your_name || "-"}</p>
<p><strong>Relación:</strong> ${metadata.relationship || "-"}</p>
<p><strong>Tarifa:</strong> ${metadata.tarifa || "-"}</p>
<p><strong>Email del cliente (Stripe):</strong> ${session.customer_details?.email || "-"}</p>
<p><strong>WhatsApp:</strong> ${metadata.whatsapp || "-"}</p>
<p><strong>Teléfono:</strong> ${metadata.phone || "-"}</p>

<hr>

<h3>❤️ HISTORIA</h3>
<p><strong>¿Cómo se conocieron?</strong><br>${metadata.how_met || "-"}</p>
<p><strong>Momento especial:</strong><br>${metadata.special_moment || "-"}</p>
<p><strong>¿Por qué esta canción es importante ahora?</strong><br>${metadata.reason_now || "-"}</p>

<hr>

<h3>🎭 EMOCIÓN Y PERSONALIDAD</h3>
<p><strong>Tres palabras que definen a la persona:</strong><br>${metadata.three_words || "-"}</p>
<p><strong>Frase / dedicatoria:</strong><br>${metadata.dedication || "-"}</p>
<p><strong>Emoción principal:</strong> ${metadata.emotion || "-"}</p>

<hr>

<h3>🎵 MÚSICA</h3>
<p><strong>Estilo musical:</strong> ${metadata.song_style || "-"}</p>
<p><strong>Ritmo:</strong> ${metadata.rhythm || "-"}</p>
<p><strong>Tipo de voz:</strong> ${metadata.voice_type || "-"}</p>
<p><strong>Idioma:</strong> ${metadata.language || "-"}</p>

<hr>

<h3>⚠️ DETALLES FINALES</h3>
<p><strong>¿Incluir nombre en la canción?</strong> ${metadata.include_name || "-"}</p>
<p><strong>Intensidad emocional:</strong> ${metadata.intensity || "-"}</p>
<p><strong>No mencionar:</strong><br>${metadata.dont_mention || "-"}</p>
`;

      await resend.emails.send({
        from: "Lirya <onboarding@resend.dev>",
        to: "proyectosbily@gmail.com", // TU EMAIL INTERNO
        subject: "🆕 Nuevo pedido – Canción personalizada",
        html: emailInterno,
      });

      console.log("✅ Email interno enviado correctamente");

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
