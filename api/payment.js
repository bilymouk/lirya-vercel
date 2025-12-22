const Stripe = require('stripe');

module.exports = async (req, res) => {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Manejar preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { formData } = req.body;

    // Crear sesión de Stripe Checkout usando el Price ID del producto "Canción"
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: 'price_1SgZIwC9ZAiICMcPbj7tDXxj', // Price ID del producto "Canción" (€19.99)
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.VERCEL_URL || 'https://lirya-vercel.vercel.app'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.VERCEL_URL || 'https://lirya-vercel.vercel.app'}/`,
      client_reference_id: JSON.stringify(formData),
      customer_email: formData.email,
      metadata: {
        recipient_name: formData.recipient_name,
        your_name: formData.your_name,
        how_met: formData.how_met,
        special_moment: formData.special_moment,
        three_words: formData.three_words,
        song_style: formData.song_style,
        dedication: formData.dedication,
        email: formData.email,
      },
    });

    return res.status(200).json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating Stripe session:', error);
    return res.status(500).json({ error: error.message });
  }
};
