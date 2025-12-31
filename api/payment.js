const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const f = req.body;

    console.log('📥 FORM DATA RECIBIDO:', f);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price: 'price_1SgZIwC9ZAiICMcPbj7tDXxj',
          quantity: 1,
        },
      ],
      success_url: `https://${process.env.VERCEL_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${process.env.VERCEL_URL}/cancel.html`,

      metadata: {
        recipient_name: f.recipient_name || '',
        your_name: f.your_name || '',
        relationship: f.relationship || '',
        tarifa: f.tarifa || '',

        how_met: f.how_met || '',
        special_moment: f.special_moment || '',
        reason_now: f.reason_now || '',

        three_words: f.three_words || '',
        dedication: f.dedication || '',
        emotion: f.emotion || '',

        song_style: f.song_style || '',
        rhythm: f.rhythm || '',
        voice_type: f.voice_type || '',
        language: f.language || '',

        include_name: f.include_name || '',
        intensity: f.intensity || '',
        dont_mention: f.dont_mention || '',

        email: f.email || '',
        whatsapp: f.whatsapp || '',
        phone: f.phone || '',
      },
    });

    console.log('✅ METADATA GUARDADA EN STRIPE:', session.metadata);

    res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('❌ Error Stripe:', err);
    res.status(500).json({ error: 'Error al crear sesión de pago' });
  }
};
