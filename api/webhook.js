const Stripe = require('stripe');
const { Resend } = require('resend');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Manejar el evento checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const formData = JSON.parse(session.client_reference_id);
    const email = session.customer_email;

    try {
      // Enviar email de confirmación
      await resend.emails.send({
        from: 'Lirya <noreply@lirya.com>',
        to: email,
        subject: '¡Tu canción personalizada está en camino!',
        html: `
          <h1>¡Gracias por tu pedido!</h1>
          <p>Hola ${formData.recipientName},</p>
          <p>Hemos recibido tu pedido para una canción personalizada.</p>
          <p><strong>Detalles del pedido:</strong></p>
          <ul>
            <li>Para: ${formData.recipientName}</li>
            <li>De: ${formData.yourName}</li>
            <li>Estilo: ${formData.style}</li>
          </ul>
          <p>Recibirás tu canción en las próximas 24 horas.</p>
          <p>¡Gracias por confiar en Lirya!</p>
        `,
      });

      console.log('Email sent successfully to:', email);
    } catch (error) {
      console.error('Error sending email:', error);
    }
  }

  res.status(200).json({ received: true });
};
