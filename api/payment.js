const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // --- 1. CONFIGURACIÓN DE SEGURIDAD (CORS) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const f = req.body; // Datos del formulario
    console.log("📥 FORM DATA RECIBIDO:", f.email);

    // --- 2. ENVIAR DATOS A MAKE (AIRTABLE) ---
    // Esto asegura que guardamos la historia AUNQUE el cliente no termine de pagar.
    try {
        // 👇👇👇 ¡PEGA AQUÍ TU URL DE MAKE! 👇👇👇
        const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/5smdni2x9ogls912ttx97ym8ftg7r1gf'; 
        
        await fetch(MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(f)
        });
        console.log("✅ Datos enviados a Make correctamente");
    } catch (makeError) {
        console.error("⚠️ Alerta: Make no respondió, pero seguimos con el cobro.", makeError);
    }

    // --- 3. CALCULAR PRECIO SEGÚN TARIFA ---
    // Convertimos la tarifa elegida (49, 59, 79) a céntimos para Stripe
    let amount = 4900; // Precio base 49.00€
    if (f.tarifa == '59') amount = 5900;
    if (f.tarifa == '79') amount = 7900;

    // --- 4. CREAR SESIÓN DE STRIPE ---
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      
      // Esto pre-rellena el email en la pasarela de pago
      customer_email: f.email, 
      
      // Configuración de facturación
      billing_address_collection: "required",
      customer_creation: "always",

      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Canción Personalizada Lirya',
              description: `Para ${f.recipient_name} (Plan ${f.tarifa}€)`,
            },
            unit_amount: amount, // Aquí usamos el precio dinámico
          },
          quantity: 1,
        },
      ],

      // Redirecciones
      success_url: `https://${process.env.VERCEL_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${process.env.VERCEL_URL}/cancel.html`,

      // Metadatos (Copia de seguridad en Stripe)
      metadata: {
        recipient_name: f.recipient_name ? f.recipient_name.substring(0, 499) : "",
        your_name: f.your_name ? f.your_name.substring(0, 499) : "",
        tarifa: f.tarifa || "",
        email_formulario: f.email || "",
        // Nota: Stripe corta los metadatos si son muy largos, 
        // por eso Make es nuestra base de datos principal ahora.
        historia_resumen: f.how_met ? f.how_met.substring(0, 490) : "" 
      },
    });

    console.log("✅ STRIPE SESSION CREADA:", session.id);
    
    res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("❌ ERROR PAYMENT:", error);
    res.status(500).json({ error: "Error al crear sesión de pago: " + error.message });
  }
};
