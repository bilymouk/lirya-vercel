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

    historia: 5000,
    genero_musical: 120,
    idioma: 40,
  };

  const out = {};
  for (const k of Object.keys(f || {})) {
    const v = f[k];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const limit = MAX[k] || 5000;
      out[k] = sanitizeString(v, limit);
    }
  }

  if (f && f.email) out.email = sanitizeEmail(f.email);

  // Normalización de alias
  if (!out.language && out.idioma) out.language = out.idioma;
  if (!out.song_style && out.genero_musical) out.song_style = out.genero_musical;

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
    const raw = req.body || {};
    const f = sanitizeFormPayload(raw);

    const eventId = sanitizeString(f.event_id, 120);
    if (!eventId) return res.status(400).json({ error: "Falta event_id" });

    const email = sanitizeEmail(f.email);
    if (!email || !email.includes("@") || email.length < 5) {
      console.warn(`⚠️ Email inválido recibido: ${raw.email}`);
      return res.status(400).json({ error: "Email no válido" });
    }

    // --- VALIDAR CAMPOS OBLIGATORIOS ---
    const requiredFields = {
      recipient_name: 'Nombre del destinatario',
      your_name: 'Tu nombre',
      relationship: 'Relación',
      how_met: 'Cómo se conocieron',
      special_moment: 'Momento especial',
      song_style: 'Estilo de canción',
    };

    const missingFields = [];
    for (const [field, label] of Object.entries(requiredFields)) {
      if (!f[field] || f[field].length < 2) {
        missingFields.push(label);
      }
    }

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: `Campos obligatorios faltantes: ${missingFields.join(', ')}` 
      });
    }

    const recipientName = sanitizeString(f.recipient_name, 100);

    console.log("🔥 PAYMENT REQUEST:", {
      email,
      tarifa: f.tarifa,
      recipient_name: recipientName,
      song_style: f.song_style,
      event_id: eventId,
      ip: ip.slice(0, 15) + "...",
      timestamp: new Date().toISOString(),
    });

    // --- 4) PRECIO SEGÚN TARIFA ---
    let amount;
    const tarifa = String(f.tarifa || "").trim();

    if (tarifa === "39") amount = 100;
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
    
    const createSessionWithTimeout = (sessionData, timeout = 10000) => {
      return Promise.race([
        stripe.checkout.sessions.create(sessionData),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Stripe timeout')), timeout)
        )
      ]);
    };

    try {
      session = await createSessionWithTimeout({
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
                name: "Canción Personalizada - San Valentín 2026",
                description: recipientName
                  ? `Para ${recipientName} | ${f.song_style || 'Estilo personalizado'} | Plan ${tarifa}€`
                  : `Canción personalizada | Plan ${tarifa}€`,
                images: ["https://lirya.studio/og.jpg"],
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
            your_name: sanitizeString(f.your_name, 100),
            relationship: sanitizeString(f.relationship, 80),
            song_style: sanitizeString(f.song_style, 120),
            rhythm: sanitizeString(f.rhythm, 40),
            voice_type: sanitizeString(f.voice_type, 40),
            language: sanitizeString(f.language, 40),
            emotion: sanitizeString(f.emotion, 80),
            event_id: eventId,
            fbp: sanitizeString(f.fbp, 200),
            fbc: sanitizeString(f.fbc, 200),
            event_source_url: safeEventSourceUrl,
            order_date: new Date().toISOString(),
            campaign_source: 'san_valentin_2026',
          },
        },

        metadata: {
          email,
          tarifa,
          recipient_name: recipientName,
          your_name: sanitizeString(f.your_name, 100),
          relationship: sanitizeString(f.relationship, 80),
          song_style: sanitizeString(f.song_style, 120),
          rhythm: sanitizeString(f.rhythm, 40),
          voice_type: sanitizeString(f.voice_type, 40),
          language: sanitizeString(f.language, 40),
          emotion: sanitizeString(f.emotion, 80),
          event_id: eventId,
          fbp: sanitizeString(f.fbp, 200),
          fbc: sanitizeString(f.fbc, 200),
          event_source_url: safeEventSourceUrl,
          order_date: new Date().toISOString(),
          campaign_source: 'san_valentin_2026',
        },
      });
    } catch (stripeErr) {
      if (stripeErr.message === 'Stripe timeout') {
        console.error("⏱️ Stripe timeout");
        return res.status(504).json({
          error: "El servidor de pago tardó demasiado. Intenta de nuevo.",
        });
      }

      console.error("❌ STRIPE ERROR:", stripeErr);
      return res.status(500).json({
        error: "Error al crear sesión de pago (Stripe)",
        details: stripeErr && stripeErr.message ? stripeErr.message : String(stripeErr),
      });
    }

    console.log("✅ STRIPE SESSION CREADA:", session.id);

    // Track descuento si lo aplicó
    if (session.total_details?.amount_discount > 0) {
      console.log("🎁 Descuento aplicado:", {
        session_id: session.id,
        discount: session.total_details.amount_discount / 100,
        final_amount: session.amount_total / 100,
      });
    }

    // --- 7) ENVIAR DATOS A MAKE (pre-pago) ---
    try {
      const MAKE_WEBHOOK_URL =
        process.env.MAKE_WEBHOOK_URL ||
        "https://hook.eu1.make.com/313f6hmo9rsa3olwmebih2ryn4fkfdoe";

      // Validar URL
      if (!MAKE_WEBHOOK_URL || !MAKE_WEBHOOK_URL.startsWith('https://hook.')) {
        console.error("❌ MAKE_WEBHOOK_URL inválida o no configurada");
      }

      const doFetch = typeof fetch === "function" ? fetch : null;

      if (!doFetch) {
        console.warn("⚠️ fetch no disponible en este runtime. Saltando Make.");
      } else {
        const payloadToMake = {
          ...f,
          email,
          recipient_name: recipientName,
          tarifa,
          stripe_session_id: session.id,
          id_de_pago: session.id,
          estado_pago: "Pendiente",
          meta_event_id: eventId,
          event_source_url: safeEventSourceUrl,
        };

        const makeResponse = await doFetch(MAKE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadToMake),
        });

        if (!makeResponse.ok) {
          console.error("⚠️ Make webhook failed:", {
            status: makeResponse.status,
            statusText: makeResponse.statusText,
            session_id: session.id,
          });
        } else {
          console.log("✅ Pedido enviado a Make con formulario completo");
        }
      }
    } catch (makeError) {
      console.error("❌ Error enviando a Make:", {
        error: makeError.message,
        session_id: session.id,
        email,
      });
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
