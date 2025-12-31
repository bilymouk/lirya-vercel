const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const formData = req.body;

    console.log('📨 DATOS FORMULARIO:', formData);

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
        recipient_name: formData.recipient_name || '',
        your_name: formData.your_name || '',
        relationship: formData.relationship || '',
        tarifa: formData.tarifa || '',
        how_met: formData.how_met || '',
        special_moment: formData.special_moment || '',
        reason_now: formData.reason_now || '',
        three_words: formData.three_words || '',
        dedication: formData.dedication || '',
        emotion: formData.emotion || '',
        song_style: formData.song_style || '',
        rhythm: formData.rhythm || '',
        voice_type: formData.voice_type || '',
        language: formData.language || '',
        include_name: formData.include_name || '',
        intensity: formData.intensity || '',
        dont_mention: formData.dont_mention || '',
        email: formData.email || '',
        whatsapp: formData.whatsapp || '',
        phone: formData.phone || '',
      },
    });

    console.log('✅ Stripe session creada:', session.id);
    console.log('🧾 METADATA GUARDADO:', session.metadata);

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('❌ Error Stripe:', err);
    res.status(500).json({ error: 'Error al procesar el pago' });
  }
};

