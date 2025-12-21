import Stripe from 'stripe';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const sig = req.headers['stripe-signature'];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const email = session.metadata.email;
        const formData = JSON.parse(session.metadata.formData);

        // Enviar email con Resend
        await resend.emails.send({
          from: 'noreply@lirya.com',
          to: 'proyectosbily@gmail.com',
          subject: `Nueva Compra - ${formData.nombre || 'Cliente'}`,
          html: `
            <h2>Nueva Compra Completada</h2>
            <p><strong>Cliente:</strong> ${formData.nombre || 'N/A'}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Teléfono:</strong> ${formData.telefono || 'N/A'}</p>
            <p><strong>Mensaje:</strong> ${formData.mensaje || 'N/A'}</p>
            <p><strong>Monto:</strong> $${(session.amount_total / 100).toFixed(2)}</p>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString()}</p>
          `,
        });

        console.log('Email enviado correctamente');
      }

      res.status(200).json({ received: true });
    } catch (error) {
      console.error('Error en webhook:', error);
      res.status(400).json({ error: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
