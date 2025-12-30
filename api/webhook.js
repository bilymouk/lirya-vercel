const Stripe = require("stripe");
const { Resend } = require("resend");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  // Stripe envía el cuerpo en raw, Vercel lo pasa como buffer
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Error verificando webhook:", err.message);
    return res.status(400).send(`Webhook Error`);
  }

  // SOLO reaccionamos cuando el pago está COMPLETADO
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Recuperamos los datos del formulario
    const data = session.metadata;

    console.log("✅ Pago confirmado. Enviando email…");

    try {
      await resend.emails.send({
        from: "Lirya <pedidos@lirya.com>",
        to: "proyectosbily@gmail.com",
        subject: "🎵 Nuevo pedido confirmado — Lirya",
        html: `
          <h2>Nueva canción personalizada</h2>
          <ul>
            <li><strong>Para:</strong> ${data.recipient_name}</li>
            <li><strong>De:</strong> ${data.your_name}</li>
            <li><strong>Relación:</strong> ${data.relationship}</li>
            <li><strong>Tarifa:</strong> ${session.amount_total / 100}€</li>
            <li><strong>Email cliente:</strong> ${data.email}</li>
            <li><strong>WhatsApp:</strong> ${data.whatsapp} ${data.phone || ""}</li>
          </ul>

          <h3>Historia</h3>
          <p><strong>Cómo se conocieron:</strong><br>${data.how_met}</p>
          <p><strong>Momento clave:</strong><br>${data.special_moment}</p>
          <p><strong>Dedicatoria:</strong><br>${data.dedication}</p>

          <h3>Música</h3>
          <ul>
            <li>Estilo: ${data.song_style}</li>
            <li>Emoción: ${data.emotion}</li>
          </ul>
        `
      });

      console.log("📩 Email enviado correctamente");

    } catch (emailError) {
      console.error("❌ Error enviando email:", emailError);
    }
  }

  res.json({ received: true });
};

