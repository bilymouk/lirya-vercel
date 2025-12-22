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

    // Crear sesión de Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: 'price_1SgZIwC9ZAiICMcPbj7tDXxj', // Price ID real de Stripe
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.VERCEL_URL || 'https://lirya-vercel.vercel.app'}/success.html`,
      cancel_url: `${process.env.VERCEL_URL || 'https://lirya-vercel.vercel.app'}`,
      metadata: {
        recipientName: formData.recipientName,
        yourName: formData.yourName,
        howMet: formData.howMet,
        specialMoment: formData.specialMoment,
        threeWords: formData.threeWords,
        style: formData.style,
        dedication: formData.dedication,
        email: formData.email,
        whatsapp: formData.whatsapp,
      },
    });

    res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Error al crear sesión de Stripe:', error);
    res.status(500).json({ error: 'Error al procesar el pago', details: error.message });
  }
};
