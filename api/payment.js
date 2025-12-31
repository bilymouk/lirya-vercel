const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS
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

    console.log('📥 Datos recibidos del formulario:', formData);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',

      line_items: [
        {
          price: 'price_1SgZIwC9ZAiICMcPbj7tDXxj',
          quantity: 1,
        },
      ],

      success_url: `https://${process.env.VERCEL_URL || 'lirya-vercel.vercel.app'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${process.env.VERCEL_URL || 'lirya-vercel.vercel.app'}/cancel.html`,

      /**
       * 🔴 AQUÍ ESTABA EL PROBLEMA
       * ✅ Ahora guardamos TODAS las respuestas
       */
      metadata: {
        // Paso 1
        recipient_name: formData.recipient_name || '',
        your_name: formData.your_name || '',
        relationship: formData.relationship || '',
        tarifa: formData.tarifa || '',

        // Paso 2
        how_met: formData.how_met || '',
        special_moment: formData.special_moment || '',
        reason_now: formData.reason_now || '',

        // Paso 3
        three_words: formData.three_words || '',
        dedication: formData.dedication || '',
        emotion: formData.emotion || '',

        // Paso 4
        song_style: formData.song_style || '',
        rhythm: formData.rhythm || '',
        voice_type: formData.voice_type || '',
        language: formData.language || '',

        // Paso 5
        include_name: formData.include_name || '',
        intensity: formData.intensity || '',
        dont_mention: formData.dont_mention || '',

        // Paso 6
        email: formData.email || '',
        whatsapp: formData.whatsapp || '',
        phone: formData.phone || '',
      },
    });

    console.log('✅ Stripe session creada:', session.id);
    console.log('🧾 Metadata guardado en Stripe:', session.metadata);

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error('❌ Error al crear sesión de Stripe:', error);
    return res.status(500).json({
      error: 'Error al procesar el pago',
      details: error.message,
    });
  }
};
