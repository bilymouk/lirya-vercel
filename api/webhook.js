const Stripe = require('stripe');
const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const resend = new Resend(process.env.RESEND_API_KEY);
      
      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      let event;

      try {
        if (webhookSecret) {
          // Validar la firma del webhook si está configurado
          const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        } else {
          // Si no hay webhook secret, usar el body directamente
          event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        }
      } catch (error) {
        console.error('Error validando webhook:', error.message);
        return res.status(400).json({ error: 'Webhook signature verification failed' });
      }

      try {
        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const email = session.metadata?.email;
          const formDataStr = session.metadata?.formData;

          if (!email) {
            console.error('No email found in session metadata');
            return res.status(200).json({ received: true });
          }

          let formData = {};
          try {
            if (formDataStr) {
              formData = typeof formDataStr === 'string' ? JSON.parse(formDataStr) : formDataStr;
            }
          } catch (parseError) {
            console.error('Error parsing formData:', parseError);
            formData = { error: 'Could not parse form data' };
          }

          // Crear HTML del email
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
              <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h1 style="color: #ff6b35; margin-top: 0;">🎵 ¡Nueva Compra Completada!</h1>
                
                <p style="color: #333; font-size: 16px;">Se ha completado exitosamente una nueva compra de canción personalizada.</p>
                
                <div style="background-color: #f9f9f9; padding: 20px; border-left: 4px solid #ff6b35; margin: 20px 0;">
                  <h2 style="color: #333; margin-top: 0;">Detalles de la Compra</h2>
                  
                  <p><strong>Nombre del Destinatario:</strong> ${formData.nombre || 'No proporcionado'}</p>
                  <p><strong>Nombre de quien regala:</strong> ${formData.tu_nombre || 'No proporcionado'}</p>
                  <p><strong>Email del Cliente:</strong> ${email}</p>
                  <p><strong>Teléfono/WhatsApp:</strong> ${formData.telefono || 'No proporcionado'}</p>
                  
                  <h3 style="color: #333;">Detalles de la Canción</h3>
                  <p><strong>¿Cómo os conocisteis?</strong> ${formData.como_os_conocisteis || 'No proporcionado'}</p>
                  <p><strong>Momento Especial:</strong> ${formData.momento_especial || 'No proporcionado'}</p>
                  <p><strong>Tres Palabras:</strong> ${formData.tres_palabras || 'No proporcionado'}</p>
                  <p><strong>Estilo de la Canción:</strong> ${formData.estilo_cancion || 'No proporcionado'}</p>
                  <p><strong>Dedicatoria:</strong> ${formData.dedicatoria || 'No proporcionada'}</p>
                  
                  <h3 style="color: #333;">Información de Pago</h3>
                  <p><strong>Monto:</strong> $${(session.amount_total / 100).toFixed(2)}</p>
                  <p><strong>Moneda:</strong> ${session.currency?.toUpperCase() || 'USD'}</p>
                  <p><strong>Fecha de Transacción:</strong> ${new Date(session.created * 1000).toLocaleString('es-ES')}</p>
                  <p><strong>ID de Sesión:</strong> ${session.id}</p>
                </div>
                
                <div style="background-color: #fff3cd; padding: 15px; border-radius: 4px; margin: 20px 0;">
                  <p style="color: #856404; margin: 0;"><strong>⏱️ Próximos Pasos:</strong> La canción será creada y entregada en las próximas 24 horas al email proporcionado.</p>
                </div>
                
                <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                
                <p style="color: #666; font-size: 12px; text-align: center;">Este es un email automático del sistema Lirya. Por favor, no responda a este email.</p>
              </div>
            </div>
          `;

          // Enviar email con Resend al email del cliente
          try {
            const emailResponse = await resend.emails.send({
              from: 'noreply@lirya.com',
              to: email,
              replyTo: email,
              subject: `🎵 Nueva Compra - Canción Personalizada para ${formData.nombre || 'Cliente'}`,
              html: emailHtml,
            });

            console.log('Email enviado correctamente:', emailResponse);
          } catch (emailError) {
            console.error('Error enviando email con Resend:', emailError);
            // No fallar la respuesta del webhook si el email falla
          }

          return res.status(200).json({ received: true, message: 'Pago procesado correctamente' });
        }

        // Otros eventos de Stripe
        if (event.type === 'checkout.session.expired') {
          console.log('Sesión de checkout expirada:', event.data.object.id);
        }

        if (event.type === 'payment_intent.succeeded') {
          console.log('Payment intent succeeded:', event.data.object.id);
        }

        if (event.type === 'payment_intent.payment_failed') {
          console.log('Payment intent failed:', event.data.object.id);
        }

        return res.status(200).json({ received: true });
      } catch (error) {
        console.error('Error procesando webhook:', error);
        return res.status(400).json({ error: error.message });
      }
    } catch (error) {
      console.error('Error en webhook:', error);
      return res.status(500).json({ error: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};
