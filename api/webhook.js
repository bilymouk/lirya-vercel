const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verificar la firma del webhook de Stripe
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Error al verificar webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Manejar el evento de pago completado
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;

    try {
      // Enviar email de confirmación usando Resend
      await resend.emails.send({
        from: 'Lirya <onboarding@resend.dev>', // Cambiar por tu dominio verificado
        to: metadata.email,
        subject: '¡Tu canción personalizada está en camino! 🎵',
        html: `
          <h1>¡Gracias por tu pedido!</h1>
          <p>Hola ${metadata.yourName},</p>
          <p>Hemos recibido tu pedido para crear una canción personalizada para <strong>${metadata.recipientName}</strong>.</p>
          
          <h2>Detalles de tu canción:</h2>
          <ul>
            <li><strong>Para:</strong> ${metadata.recipientName}</li>
            <li><strong>De:</strong> ${metadata.yourName}</li>
            <li><strong>Cómo os conocisteis:</strong> ${metadata.howMet}</li>
            <li><strong>Momento especial:</strong> ${metadata.specialMoment}</li>
            <li><strong>Palabras clave:</strong> ${metadata.threeWords}</li>
            <li><strong>Estilo:</strong> ${metadata.style}</li>
            ${metadata.dedication ? `<li><strong>Dedicatoria:</strong> ${metadata.dedication}</li>` : ''}
          </ul>
          
          <p>Recibirás tu canción en las próximas <strong>24 horas</strong> en este mismo email.</p>
          
          <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
          
          <p>Con cariño,<br>El equipo de Lirya</p>
        `,
      });

      console.log('Email enviado correctamente a:', metadata.email);
    } catch (error) {
      console.error('Error al enviar email:', error);
    }
  }

  res.status(200).json({ received: true });
};
