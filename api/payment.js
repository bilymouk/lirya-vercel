const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const ALLOWED_ORIGINS = [
  "https://lirya.studio",
  "https://www.lirya.studio",
];

// ===== RATE LIMITING =====
const rateLimiter = new Map();
const RATE_LIMIT = 10; // requests per window
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip || "unknown";
  const record = rateLimiter.get(key) || { count: 0, resetTime: now + RATE_WINDOW };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_WINDOW;
  } else {
    record.count++;
  }

  rateLimiter.set(key, record);

  // Cleanup old entries
  if (rateLimiter.size > 1000) {
    for (const [k, v] of rateLimiter.entries()) {
      if (now > v.resetTime) rateLimiter.delete(k);
    }
  }

  return record.count <= RATE_LIMIT;
}

// ===== INPUT SANITIZATION =====
function sanitizeString(str, maxLength = 500) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/[<>'"]/g, "") // Remove dangerous chars
    .trim()
    .slice(0, maxLength);
}

function sanitizeEmail(email) {
  if (!email) return "";
  return String(email).toLowerCase().trim().slice(0, 254);
}

/**
 * Sanitiza un objeto plano (key: value) con límites por campo.
 * Ojo: no convierte objetos anidados (Stripe/Make no los necesitas aquí).
 */
function sanitizeFormPayload(f) {
  const MAX = {
    recipient_name: 100,
    your_name: 100,
    relationship: 80,
    tarifa: 10,

    how_met: 5000,
    special_moment: 5000,
    reason_now: 80,

    three_words: 200,
    dedication: 5000,
    emotion: 80,

    song_style: 120,
    rhythm: 40,
    voice_type: 40,
    language: 40,

    include_name: 10,
    dont_mention: 5000,
    intensity: 40,

    whatsapp: 10,
    phone: 40,

    event_id: 120,
    fbp: 200,
    fbc: 200,
    event_source_url: 2000,

    // compat / legacy (por si algún día mandaste esto)
    historia: 5000,
    genero_musical: 120,
    idioma: 40,
  };

  const out = {};
  for (const k of Object.keys(f || {})) {
    const v = f[k];
    // solo valores primitivos
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const limit = MAX[k] || 5000;
      out[k] = sanitizeString(v, limit);
    }
  }

  // email aparte (con su sanitización)
  if (f && f.email) out.email = sanitizeEmail(f.email);

  // Normalización de alias para evitar mismatch:
  // si llega "idioma" pero no "language", lo copiamos
  if (!out.language && out.idioma) out.language = out.idioma;
  // si llega "genero_musical" pero no "song_style", lo copiamos
  if (!out.song_style && out.genero_musical) out.song_style = out.genero_musical;
  // si llega "historia" pero faltan campos, lo dejamos como extra
  // (no rompe Make, simplemente añade campo)

  return out;
}

module.exports = async (req, res) => {
  // --- 1) CORS ---
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  // --- 2) RATE LIMITING ---
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "");

  if (!checkRateLimit(ip)) {
    console.warn(`⚠️ Rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({
      error: "Demasiadas solicitudes. Intenta de nuevo en un minuto.",
    });
  }

  try {
    // 3) Body original + sanitizado
    const raw = req.body || {};
    const f = sanitizeFormPayload(raw);

    const eventId = sanitizeString(f.event_id, 120);
    if (!eventId) return res.status(400).json({ error: "Falta event_id" });

    const email = sanitizeEmail(f.email);
    if (!email || !email.includes("@") || email.length < 5) {
      console.warn(`⚠️ Email inválido recibido: ${raw.email}`);
      return res.status(400).json({ error: "Email no válido" });
    }

    const recipientName = sanitizeString(f.recipient_name, 100);

    console.log("📥 FORM DATA RECIBIDO - Email:", email, "Tarifa:", f.tarifa);

    // --- 4) PRECIO SEGÚN TARIFA ---
    let amount;
    const tarifa = String(f.tarifa || "").trim();

    if (tarifa === "39") amount = 3900;
    else if (tarifa === "59") amount = 5900;
    else if (tarifa === "79") amount = 7900;
    else {
      console.warn(`⚠️ Tarifa inválida: ${tarifa}`);
      return res.status(400).json({ error: "Tarifa no válida" });
    }

    // --- 5) BASE_URL INFALIBLE ---
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

    // ✅ Event source URL limpio
    let safeEventSourceUrl = sanitizeString(f.event_source_url, 2000);
    if (safeEventSourceUrl) {
      try {
        const u = new URL(safeEventSourceUrl);
        safeEventSourceUrl = u.origin + u.pathname;
      } catch (_) {
        safeEventSourceUrl = `${BASE_URL}/`;
      }
    } else {
      safeEventSourceUrl = `${BASE_URL}/`;
    }

    // --- 6) CREAR SESIÓN DE STRIPE ---
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        allow_promotion_codes: true,
        customer_email: email,

        billing_address_collection: "required",
        customer_creation: "always",

        client_reference_id: eventId,

        line_items: [
          {
            price_data: {
              currency: "eur",
              product_data: {
                name: "Canción Personalizada Lirya",
                description: recipientName
                  ? `Para ${recipientName} (Plan ${tarifa}€)`
                  : `Plan ${tarifa}€`,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],

        success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&event_id=${encodeURIComponent(
          eventId
        )}`,
        cancel_url: `${BASE_URL}/cancel.html?event_id=${encodeURIComponent(eventId)}`,

        payment_intent_data: {
          metadata: {
            email,
            tarifa,
            recipient_name: recipientName,
            event_id: eventId,
            fbp: sanitizeString(f.fbp, 200),
            fbc: sanitizeString(f.fbc, 200),
            event_source_url: safeEventSourceUrl,
          },
        },

        metadata: {
          email,
          tarifa,
          recipient_name: recipientName,
          event_id: eventId,
          fbp: sanitizeString(f.fbp, 200),
          fbc: sanitizeString(f.fbc, 200),
          event_source_url: safeEventSourceUrl,
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

    // --- 7) ENVIAR DATOS A MAKE (pre-pago) ---
    // ✅ Aquí está el arreglo: enviamos TODO el formulario (f) + datos de Stripe
    try {
      const MAKE_WEBHOOK_URL =
        process.env.MAKE_WEBHOOK_URL ||
        "https://hook.eu1.make.com/313f6hmo9rsa3olwmebih2ryn4fkfdoe";

      const doFetch = typeof fetch === "function" ? fetch : null;

      if (!doFetch) {
        console.warn("⚠️ fetch no disponible en este runtime. Saltando Make.");
      } else {
        const payloadToMake = {
          ...f, // ✅ TODO: how_met, dedication, song_style, etc.
          email, // asegurado
          recipient_name: recipientName, // asegurado
          tarifa, // asegurado

          stripe_session_id: session.id,
          id_de_pago: session.id,
          estado_pago: "Pendiente",
          meta_event_id: eventId,

          // si Make/airtable usa este campo, lo pasamos normalizado también:
          event_source_url: safeEventSourceUrl,
        };

        await doFetch(MAKE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadToMake),
        });

        console.log("✅ Pedido enviado a Make con formulario completo");
      }
    } catch (makeError) {
      console.error("⚠️ Error enviando a Make (seguimos igual):", makeError);
    }

    // --- 8) DEVOLVER URL PARA REDIRIGIR A STRIPE ---
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("❌ ERROR PAYMENT:", error);
    return res.status(500).json({
      error: "Error al crear sesión de pago",
      details: error && error.message ? error.message : String(error),
    });
  }
};
