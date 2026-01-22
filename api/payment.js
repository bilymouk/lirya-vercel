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
    const f = req.body || {};
    console.log("📥 FORM DATA RECIBIDO:", f.email);

    // --- 2. CALCULAR PRECIO SEGÚN TARIFA ---
    let amount;
    if (f.tarifa == "49") amount = 100;
    else if (f.tarifa == "59") amount = 5900;
    else if (f.tarifa == "79") amount = 7900;
    else {
      return res.status(400).json({ error: "Tarifa no válida" });
    }

    // --- 2.1 VALIDACIÓN MÍNIMA (evita sesiones basura) ---
    if (!f.email || typeof f.email !== "string" || !f.email.includes("@")) {
      return res.status(400).json({ error: "Email no válido" });
    }

    // --- 3. BASE_URL INFALIBLE (dominio real) ---
    // Prioridad:
    // 1) SITE_URL (ideal: https://lirya.studio)
    // 2) Host real del request (sirve para dominio custom)
    // 3) VERCEL_URL como fallback
    const envUrl = (process.env.SITE_URL || "").trim();

    const proto = (req.headers["x-forwarded-proto"] || "https")
      .toString()
      .split(",")[0]
      .trim();

    const host = (req.headers["x-forwarded-host"] || req.headers.host || "")
      .toString()
      .split(",")[0]
      .trim();

    let BASE_URL = "";
    if (envUrl) {
      BASE_URL = envUrl.startsWith("http") ? envUrl : `https://${envUrl}`;
    } else if (host) {
      BASE_URL = `${proto}://${host}`;
    } else if (process.env.VERCEL_URL) {
      BASE_URL = `https://${process.env.VERCEL_URL}`;
    }

    if (!BASE_URL.startsWith("http")) {
      console.error("❌ BASE_URL inválida:", BASE_URL);
      return res.status(500).json({ error: "BASE_URL inválida" });
    }

    console.log("🌍 BASE_URL:", BASE_URL);

    // --- 4. CREAR SESIÓN DE STRIPE ---
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        allow_promotion_codes: true,
        customer_email: f.email,

        billing_address_collection: "required",
        customer_creation: "always",

        line_items: [
          {
            price_data: {
              currency: "eur",
              product_data: {
                name: "Canción Personalizada Lirya",
                description: `Para ${f.recipient_name || ""} (Plan ${f.tarifa}€)`,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],

        success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${BASE_URL}/cancel.html`,

        metadata: {
          email: f.email || "",
          tarifa: f.tarifa || "",
          recipient_name: f.recipient_name || "",
        },
      });
    } catch (stripeErr) {
      console.error("❌ STRIPE ERROR:", stripeErr);
      return res.status(500).json({
        error: "Error al crear sesión de pago (Stripe)",
        details: stripeErr && stripeErr.message ? stripeErr.message : String(stripeErr),
      });
    }

    console.log("✅ STRIPE SESSION CREADA:", session.id);

    // --- 5. ENVIAR DATOS A MAKE (PEDIDO PRE-PAGO, YA CON ID) ---
    try {
      const MAKE_WEBHOOK_URL =
        "https://hook.eu1.make.com/313f6hmo9rsa3olwmebih2ryn4fkfdoe"; // Pedido_cancion_web

      // fetch puede no existir en algunos runtimes -> fallback seguro
      const doFetch = typeof fetch === "function" ? fetch : null;

      if (!doFetch) {
        console.warn("⚠️ fetch no disponible en este runtime. Saltando Make.");
      } else {
        await doFetch(MAKE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...f,
            id_de_pago: session.id,   // 🔑 CLAVE
            estado_pago: "Pendiente", // 🔑 CLAVE
          }),
        });

        console.log("✅ Pedido enviado a Make con ID de pago");
      }
    } catch (makeError) {
      console.error("⚠️ Error enviando a Make (seguimos igual):", makeError);
    }

    // --- 6. DEVOLVER URL PARA REDIRIGIR A STRIPE ---
    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("❌ ERROR PAYMENT:", error);
    return res.status(500).json({
      error: "Error al crear sesión de pago",
      details: error && error.message ? error.message : String(error),
    });
  }
};
