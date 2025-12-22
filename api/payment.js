const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Habilitar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const formData = req.body;

    console.log('Datos recibidos del formulario:', formData);

    // Crear sesión de Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: 'price_1SgZIwC9ZAiICMcPbj7tDXxj', // Price ID correcto
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `https://${process.env.VERCEL_URL || 'lirya-vercel.vercel.app'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${process.env.VERCEL_URL || 'lirya-vercel.vercel.app'}/cancel.html`,
      metadata: {
        recipient_name: formData.recipient_name || '',
        your_name: formData.your_name || '',
        how_met: formData.how_met || '',
        special_moment: formData.special_moment || '',
        three_words: formData.three_words || '',
        song_style: formData.song_style || '',
        dedication: formData.dedication || '',
        email: formData.email || '',
        whatsapp: formData.whatsapp || '',
      },
    });

    console.log('Sesión de Stripe creada:', session.id);
    console.log('Metadata guardado:', session.metadata);

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Error al crear sesión de Stripe:', error);
    res.status(500).json({ error: 'Error al procesar el pago', details: error.message });
  }
};
