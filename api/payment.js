const Stripe = require('stripe');

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
      // Parsear el body
      const body = await request.json();
      const { formData } = body;

      // Inicializar Stripe
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      // Crear sesión de Stripe Checkout
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'eur',
              product_data: {
                name: 'Canción Personalizada',
                description: `Para ${formData.recipient_name} de ${formData.your_name}`,
              },
              unit_amount: 9900, // 99€ en centavos
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${process.env.VERCEL_URL || 'https://lirya-vercel.vercel.app'}/success`,
        cancel_url: `${process.env.VERCEL_URL || 'https://lirya-vercel.vercel.app'}/cancel`,
        client_reference_id: JSON.stringify(formData),
        customer_email: formData.email,
      });

      return new Response(JSON.stringify({ sessionId: session.id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error creating Stripe session:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
