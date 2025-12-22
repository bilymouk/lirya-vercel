const Stripe = require('stripe');
const { Resend } = require('resend');

export default {
  async fetch(request) {
    // Solo aceptar POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      // Obtener el body raw
      const body = await request.text();
      const signature = request.headers.get('stripe-signature');

      // Inicializar Stripe
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      // Verificar el webhook
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          body,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return new Response(JSON.stringify({ error: 'Webhook signature verification failed' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Procesar el evento checkout.session.completed
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const formData = JSON.parse(session.client_reference_id || '{}');
        const email = session.customer_email || formData.email;

        // Enviar email de confirmación con Resend
        const resend = new Resend(process.env.RESEND_API_KEY);
        
        await resend.emails.send({
          from: 'Lirya <onboarding@resend.dev>',
          to: email,
          subject: '¡Tu canción personalizada está en camino! 🎵',
          html: `
            <h1>¡Gracias por tu pedido!</h1>
            <p>Hemos recibido tu pago y comenzaremos a crear tu canción personalizada.</p>
            <h2>Detalles de tu canción:</h2>
            <ul>
              <li><strong>Para:</strong> ${formData.recipient_name}</li>
              <li><strong>De:</strong> ${formData.your_name}</li>
              <li><strong>Estilo:</strong> ${formData.song_style}</li>
              <li><strong>Tres palabras:</strong> ${formData.three_words}</li>
            </ul>
            <p>Recibirás tu canción en las próximas 24 horas.</p>
            <p>¡Gracias por confiar en Lirya!</p>
          `,
        });

        console.log('Email sent successfully to:', email);
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error processing webhook:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
