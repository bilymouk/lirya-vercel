const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // --- 1. CONFIGURACIÓN CORS ---
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

    // --- 2. CALCULAR PRECIO SEGÚN TARIFA ---
    let amount;

    if (f.tarifa == '49') {
      amount = 4900;
    } else if (f.tarifa == '59') {
      amount = 5900;
    } else if (f.tarifa == '79') {
      amount = 7900;
    } else {
      return res.status(400).json({ error: "Tarifa no válida" });
    }

    // --- 3. CREAR SESIÓN DE STRIPE ---
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      // Email pre-rellenado en Stripe
      customer_email: f.email,

      // Facturación
      billing_address_collection: "required",
      customer_creation: "always",

      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Canción Personalizada Lirya',
              description: `Para ${f.recipient_name || ""} (Plan ${f.tarifa}€)`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],

      // Redirecciones
      success_url: `https://${process.env.VERCEL_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${process.env.VERCEL_URL}/cancel.html`,

      // --- 4. METADATA (CLAVE PARA EL WEBHOOK) ---
      // Guardamos TODO aquí. Stripe avisará después cuando el pago sea REAL.
      metadata: {
        ...f
      },
    });

    console.log("✅ STRIPE SESSION CREADA:", session.id);

    // Devolvemos la URL de pago al frontend
    res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("❌ ERROR PAYMENT:", error);
    res.status(500).json({ error: "Error al crear sesión de pago: " + error.message });
  }
};
