import Stripe from 'stripe';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const { amount, email, formData } = req.body;

      // Crear sesión de pago con Stripe
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Canción Personalizada - Lirya',
                description: 'Tu canción personalizada creada con Lirya',
              },
              unit_amount: Math.round(amount * 100), // Convertir a centavos
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${process.env.VERCEL_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.VERCEL_URL}/cancel`,
        metadata: {
          email: email,
          formData: JSON.stringify(formData),
        },
      });

      res.status(200).json({ sessionId: session.id });
    } catch (error) {
      console.error('Error en payment:', error);
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
