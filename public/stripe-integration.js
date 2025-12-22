// Integración de Stripe en el formulario
const stripe = Stripe('pk_test_51SgUupC9ZAiICMcP3OfhdZLYpGryFLgCz03OJtZQJ9Ta8WtgxhkaT6cV8PvrbK3dStOy6tEiuJoKlCKd8yvzFpvS00DNc9z8Ut');

// Obtener el botón de pago
const payBtn = document.getElementById('payBtn');

if (payBtn) {
  payBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    // Obtener datos del formulario
    const recipientName = document.getElementById('recipient-name').value;
    const yourName = document.getElementById('your-name').value;
    const howMet = document.getElementById('how-met').value;
    const specialMoment = document.getElementById('special-moment').value;
    const threeWords = document.getElementById('three-words').value;
    const songStyle = document.querySelector('input[name="song-style"]:checked').value;
    const dedication = document.getElementById('dedication').value;
    const email = document.getElementById('email').value;
    const whatsappChoice = document.getElementById('whatsapp-yes').checked;
    const whatsappNumber = whatsappChoice ? document.getElementById('whatsapp-number').value : null;

    // Validar que el email sea válido
    if (!email || !email.includes('@')) {
      alert('Por favor ingresa un email válido');
      return;
    }

    // Deshabilitar el botón mientras se procesa
    payBtn.disabled = true;
    payBtn.textContent = 'Procesando...';

    try {
      // Enviar solicitud al servidor para crear sesión de Stripe
      const response = await fetch('/api/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 49.99, // Precio de la canción personalizada
          email: email,
          formData: {
            nombre: recipientName,
            tu_nombre: yourName,
            como_os_conocisteis: howMet,
            momento_especial: specialMoment,
            tres_palabras: threeWords,
            estilo_cancion: songStyle,
            dedicatoria: dedication,
            email: email,
            whatsapp: whatsappNumber,
            telefono: whatsappNumber || 'No proporcionado',
            mensaje: `Canción personalizada para ${recipientName}. Estilo: ${songStyle}`
          },
        }),
      });

      const data = await response.json();

      if (data.error) {
        alert('Error: ' + data.error);
        payBtn.disabled = false;
        payBtn.textContent = 'Crear mi canción';
        return;
      }

      if (data.sessionId) {
        console.log('Sesión de Stripe creada:', data.sessionId);
        
        // Redirigir a Stripe Checkout
        const result = await stripe.redirectToCheckout({
          sessionId: data.sessionId,
        });

        if (result.error) {
          alert('Error: ' + result.error.message);
          payBtn.disabled = false;
          payBtn.textContent = 'Crear mi canción';
        }
      } else {
        alert('Error al procesar el pago: No se recibió sessionId');
        payBtn.disabled = false;
        payBtn.textContent = 'Crear mi canción';
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error al procesar el pago: ' + error.message);
      payBtn.disabled = false;
      payBtn.textContent = 'Crear mi canción';
    }
  });
}

console.log('Stripe integration loaded');
