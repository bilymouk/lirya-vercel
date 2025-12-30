import Stripe from 'stripe';
import getRawBody from 'raw-body';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false, // 🔴 MUY IMPORTANTE
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Error verificando webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 🔔 SOLO nos importa cuando el pago se completa
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    console.log('✅ Pago confirmado');
    console.log('📦 Metadata:', session.metadata);

    // 👉 AQUÍ luego enviaremos el email con Resend
  }

  res.json({ received: true });
}
