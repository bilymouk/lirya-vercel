const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verificar la firma del webhook de Stripe
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Error al verificar webhook:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Manejar el evento de pago completado
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;

    console.log('Pago completado. Session ID:', session.id);
    console.log('Metadata recibido:', metadata);

    try {
      // Enviar email con los datos del formulario a tu email (ayuda@lirya.com)
      await resend.emails.send({
        from: 'Lirya <onboarding@resend.dev>',
        to: 'ayuda@lirya.com', // Tu email donde recibirás los datos
        subject: `🎵 Nuevo pedido de canción - ${metadata.recipient_name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h1 style="color: #d4a574; margin-bottom: 20px;">🎵 Nuevo Pedido de Canción</h1>
              
              <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                <p style="margin: 5px 0;"><strong>ID de Sesión:</strong> ${session.id}</p>
                <p style="margin: 5px 0;"><strong>Monto pagado:</strong> ${(session.amount_total / 100).toFixed(2)} ${session.currency.toUpperCase()}</p>
              </div>
              
              <h2 style="color: #333; font-size: 18px; margin-top: 25px;">📋 Datos del Formulario:</h2>
              
              <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <tr style="background-color: #f9f9f9;">
                  <td style="padding: 10px; border: 1px solid #ddd;"><strong>Para (destinatario):</strong></td>
                  <td style="padding: 10px; border: 1px solid #ddd;">${metadata.recipient_name}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border: 1px solid #ddd;"><strong>De (quien regala):</strong></td>
                  <td style="padding: 10px; border: 1px solid #ddd;">${metadata.your_name}</td>
                </tr>
                <tr style="background-color: #f9f9f9;">
                  <td style="padding: 10px; border: 1px solid #ddd;"><strong>Cómo se conocieron:</strong></td>
                  <td style="padding: 10px; border: 1px solid #ddd;">${metadata.how_met}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border: 1px solid #ddd;"><strong>Momento especial:</strong></td>
                  <td style="padding: 10px; border: 1px solid #ddd;">${metadata.special_moment}</td>
                </tr>
                <tr style="background-color: #f9f9f9;">
                  <td style="padding: 10px; border: 1px solid #ddd;"><strong>Tres palabras:</strong></td>
                  <td style="padding: 10px; border: 1px solid #ddd;">${metadata.three_words}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border: 1px solid #ddd;"><strong>Estilo de canción:</strong></td>
                  <td style="padding: 10px; border: 1px solid #ddd;">${metadata.song_style}</td>
                </tr>
                ${metadata.dedication ? `
                <tr style="background-color: #f9f9f9;">
                  <td style="padding: 10px; border: 1px solid #ddd;"><strong>Dedicatoria:</strong></td>
                  <td style="padding: 10px; border: 1px solid #ddd;">${metadata.dedication}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 10px; border: 1px solid #ddd;"><strong>Email del cliente:</strong></td>
                  <td style="padding: 10px; border: 1px solid #ddd;">${metadata.email}</td>
                </tr>
                ${metadata.whatsapp ? `
                <tr style="background-color: #f9f9f9;">
                  <td style="padding: 10px; border: 1px solid #ddd;"><strong>WhatsApp:</strong></td>
                  <td style="padding: 10px; border: 1px solid #ddd;">${metadata.whatsapp}</td>
                </tr>
                ` : ''}
              </table>
              
              <div style="margin-top: 30px; padding: 15px; background-color: #e8f5e9; border-left: 4px solid #4caf50; border-radius: 5px;">
                <p style="margin: 0; color: #2e7d32;"><strong>✅ Pago confirmado</strong></p>
                <p style="margin: 5px 0 0 0; color: #555; font-size: 14px;">El cliente ha completado el pago exitosamente.</p>
              </div>
            </div>
          </div>
        `,
      });

      console.log('Email enviado correctamente a ayuda@lirya.com');

      // También enviar email de confirmación al cliente
      await resend.emails.send({
        from: 'Lirya <onboarding@resend.dev>',
        to: metadata.email,
        subject: '¡Tu canción personalizada está en camino! 🎵',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: #ffffff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h1 style="color: #d4a574; margin-bottom: 20px;">¡Gracias por tu pedido! 🎵</h1>
              
              <p style="font-size: 16px; line-height: 1.6;">Hola <strong>${metadata.your_name}</strong>,</p>
              
              <p style="font-size: 16px; line-height: 1.6;">
                Hemos recibido tu pedido para crear una canción personalizada para <strong>${metadata.recipient_name}</strong>. 
                Nuestro equipo comenzará a trabajar en ella de inmediato.
              </p>
              
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h2 style="color: #333; font-size: 18px; margin-top: 0;">📋 Resumen de tu canción:</h2>
                <ul style="list-style: none; padding: 0;">
                  <li style="padding: 8px 0; border-bottom: 1px solid #ddd;">
                    <strong>Para:</strong> ${metadata.recipient_name}
                  </li>
                  <li style="padding: 8px 0; border-bottom: 1px solid #ddd;">
                    <strong>De:</strong> ${metadata.your_name}
                  </li>
                  <li style="padding: 8px 0; border-bottom: 1px solid #ddd;">
                    <strong>Estilo:</strong> ${metadata.song_style}
                  </li>
                  <li style="padding: 8px 0;">
                    <strong>Palabras clave:</strong> ${metadata.three_words}
                  </li>
                </ul>
              </div>
              
              <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3 style="color: #1976d2; margin-top: 0;">⏰ ¿Qué sigue ahora?</h3>
                <ul style="line-height: 1.8;">
                  <li>Crearemos tu canción personalizada basada en tu historia</li>
                  <li>Te enviaremos la canción en formato MP3 en menos de <strong>24 horas</strong></li>
                  <li>Si necesitas algún ajuste, estaremos encantados de ayudarte</li>
                </ul>
              </div>
              
              <p style="font-size: 16px; line-height: 1.6;">
                Si tienes alguna pregunta, no dudes en contactarnos respondiendo a este email o escribiendo a 
                <a href="mailto:ayuda@lirya.com" style="color: #d4a574; text-decoration: none;">ayuda@lirya.com</a>
              </p>
              
              <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #f0f0f0; text-align: center;">
                <p style="color: #888; font-size: 14px; margin: 0;">Con cariño,</p>
                <p style="color: #d4a574; font-size: 18px; font-weight: bold; margin: 5px 0;">El equipo de Lirya</p>
              </div>
            </div>
          </div>
        `,
      });

      console.log('Email de confirmación enviado al cliente:', metadata.email);

    } catch (error) {
      console.error('Error al enviar email:', error);
    }
  }

  res.status(200).json({ received: true });
};
