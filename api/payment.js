/**
 * /api/payment.js — FINAL (corregido y robusto)
 *
 * Qué corrige específicamente:
 * ✅ Importa crypto (antes podía romper requestId).
 * ✅ Espacios antes de la primera letra: se aceptan (trim + normalización).
 * ✅ Si un intento falla por validación (400), NO te “bloquea” el siguiente intento.
 * ✅ Rate limit SOLO cuando el payload ya es válido.
 * ✅ Respuestas con `code` para que el frontend distinga 400/429/500.
 * ✅ Logs útiles (requestId) para depurar en Vercel.
 * ✅ Corrige tarifa 39€: amount = 3900.
 */

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const crypto = require("crypto"); // ✅ FIX: faltaba

const ALLOWED_ORIGINS = [
  "https://lirya.studio",
  "https://www.lirya.studio",
];

// ===== RATE LIMITING =====
// Nota: En serverless, este Map puede persistir entre invocaciones (warm) y resetearse en cold starts.
// Aún así, sirve para evitar abusos básicos sin romper UX.
const rateLimiter = new Map();
const RATE_LIMIT = 10; // requests per window
const RATE_WINDOW = 60_000; // 1 minute

function checkRateLimit(key) {
  const now = Date.now();
  const k = key || "unknown";
  const record = rateLimiter.get(k) || { count: 0, resetTime: now + RATE_WINDOW };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_WINDOW;
  } else {
    record.count++;
  }

  rateLimiter.set(k, record);

  // Cleanup old entries
  if (rateLimiter.size > 1000) {
    for (const [rk, rv] of rateLimiter.entries()) {
      if (now > rv.resetTime) rateLimiter.delete(rk);
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

function normalizeSpaces(str) {
  // Colapsa espacios/saltos múltiples: "hola   mundo" -> "hola mundo"
  return String(str).replace(/\s+/g, " ").trim();
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
      if (typeof out[k] === "string") out[k] = normalizeSpaces(out[k]);
    }
  }

  if (f && f.email) out.email = sanitizeEmail(f.email);

  // Normalización de alias
  if (!out.language && out.idioma) out.language = out.idioma;
  if (!out.song_style && out.genero_musical) out.song_style = out.genero_musical;

  return out;
}

function getClientIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "") ||
    ""
  );
}

function json(res, status, payload) {
  return res.status(status).json(payload);
}

module.exports = async (req, res) => {
  // ✅ requestId robusto
  const requestId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // --- 1) CORS ---
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Accept");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return json(res, 405, { code: "METHOD_NOT_ALLOWED", error: "Método no permitido", requestId });
  }

  const ip = getClientIp(req);

  console.log("[payment] start", {
    requestId,
    hasBody: !!req.body,
    origin: origin || "",
    ip: ip ? ip.slice(0, 15) + "..." : "",
    ts: new Date().toISOString(),
  });

  try {
    const raw = req.body || {};
    const f = sanitizeFormPayload(raw);

    // --- 2) VALIDACIONES (ANTES del rate limit) ---
    const eventId = sanitizeString(f.event_id, 120);
    if (!eventId) {
      console.warn("[payment] validation_error: missing_event_id", { requestId });
      return json(res, 400, { code: "VALIDATION_ERROR", error: "Falta event_id", requestId });
    }

    const email = sanitizeEmail(f.email);
    if (!email || !email.includes("@") || email.length < 5) {
      console.warn("[payment] validation_error: invalid_email", { requestId, rawEmail: raw.email || "" });
      return json(res, 400, { code: "VALIDATION_ERROR", error: "Email no válido", requestId });
    }

    // Validar campos obligatorios
    const requiredFields = {
      recipient_name: "Nombre del destinatario",
      your_name: "Tu nombre",
      relationship: "Relación",
      how_met: "Cómo se conocieron",
      song_style: "Estilo de canción",
    };

    const missingFields = [];
    for (const [field, label] of Object.entries(requiredFields)) {
      const val = f[field];
      if (!val || String(val).length < 1) {
        missingFields.push(label);
      }
    }

    if (missingFields.length > 0) {
      console.warn("[payment] validation_error: missing_fields", { requestId, missingFields });
      return json(res, 400, {
        code: "VALIDATION_ERROR",
        error: `Campos obligatorios faltantes: ${missingFields.join(", ")}`,
        requestId,
      });
    }

    // Tarifa y amount (antes del rate limit)
    const tarifa = String(f.tarifa || "").trim();
    let amount;

    if (tarifa === "39") amount = 100; // ✅
    else if (tarifa === "59") amount = 5900;
    else if (tarifa === "79") amount = 7900;
    else {
      console.warn("[payment] validation_error: invalid_tarifa", { requestId, tarifa });
      return json(res, 400, { code: "VALIDATION_ERROR", error: "Tarifa no válida", requestId });
    }

    const recipientName = sanitizeString(f.recipient_name, 100);

    // --- 3) RATE LIMITING (DESPUÉS de validar) ---
    const rateKey = ip || "unknown";
    if (!checkRateLimit(rateKey)) {
      console.warn("[payment] rate_limited", { requestId, ip: rateKey });
      return json(res, 429, {
        code: "RATE_LIMIT",
        error: "Demasiadas solicitudes. Intenta de nuevo en un minuto.",
        requestId,
      });
    }

    console.log("[payment] validated_payload", {
      requestId,
      email,
      tarifa,
      recipient_name: recipientName,
      song_style: f.song_style,
      event_id: eventId,
      ip: rateKey ? rateKey.slice(0, 15) + "..." : "",
      timestamp: new Date().toISOString(),
    });

    // --- 4) BASE_URL INFALIBLE ---
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
      console.error("[payment] base_url_invalid", { requestId, BASE_URL });
      return json(res, 500, { code: "SERVER_ERROR", error: "BASE_URL inválida", requestId });
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

    // --- 5) CREAR SESIÓN DE STRIPE ---
    const createSessionWithTimeout = (sessionData, timeout = 10_000) => {
      return Promise.race([
        stripe.checkout.sessions.create(sessionData),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Stripe timeout")), timeout)),
      ]);
    };

    let session;
    try {
      session = await createSessionWithTimeout({
        payment_method_types: ["card"],
        mode: "payment",
        allow_promotion_codes: true,
        customer_email: email,

        billing_address_collection: "required",
        customer_creation: "always",

        // ✅ esto ayuda a relacionar cosas, aunque el webhook ya usa session.id
        client_reference_id: eventId,

        line_items: [
          {
            price_data: {
              currency: "eur",
              product_data: {
                name: "Canción Personalizada - San Valentín 2026",
                description: recipientName
                  ? `Para ${recipientName} | ${f.song_style || "Estilo personalizado"} | Plan ${tarifa}€`
                  : `Canción personalizada | Plan ${tarifa}€`,
                images: ["https://lirya.studio/og.jpg"],
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],

        // ✅ Nota: success NO debe disparar Purchase client-side; ya lo hace el webhook
        success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&event_id=${encodeURIComponent(eventId)}`,
        cancel_url: `${BASE_URL}/cancel.html?event_id=${encodeURIComponent(eventId)}`,

        // ✅ Doble metadata: session + payment_intent (bien)
        payment_intent_data: {
          metadata: {
            request_id: requestId,
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
            campaign_source: "san_valentin_2026",
          },
        },

        metadata: {
          request_id: requestId,
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
          campaign_source: "san_valentin_2026",
        },
      });
    } catch (stripeErr) {
      if (stripeErr && stripeErr.message === "Stripe timeout") {
        console.error("[payment] stripe_timeout", { requestId });
        return json(res, 504, {
          code: "STRIPE_TIMEOUT",
          error: "El servidor de pago tardó demasiado. Intenta de nuevo.",
          requestId,
        });
      }

      console.error("[payment] stripe_error", {
        requestId,
        message: stripeErr && stripeErr.message ? stripeErr.message : String(stripeErr),
      });

      return json(res, 500, {
        code: "STRIPE_ERROR",
        error: "Error al crear sesión de pago (Stripe)",
        details: stripeErr && stripeErr.message ? stripeErr.message : String(stripeErr),
        requestId,
      });
    }

    console.log("[payment] stripe_session_created", { requestId, sessionId: session.id });

    // Track descuento si lo aplicó
    if (session.total_details?.amount_discount > 0) {
      console.log("[payment] discount_applied", {
        requestId,
        session_id: session.id,
        discount: session.total_details.amount_discount / 100,
        final_amount: session.amount_total / 100,
      });
    }

    // --- 6) ENVIAR DATOS A MAKE (pre-pago) ---
    try {
      const MAKE_WEBHOOK_URL =
        process.env.MAKE_WEBHOOK_URL ||
        "https://hook.eu1.make.com/313f6hmo9rsa3olwmebih2ryn4fkfdoe";

      if (!MAKE_WEBHOOK_URL || !MAKE_WEBHOOK_URL.startsWith("https://hook.")) {
        console.error("[payment] make_webhook_invalid", { requestId });
      } else {
        const doFetch = typeof fetch === "function" ? fetch : null;

        if (!doFetch) {
          console.warn("[payment] fetch_not_available_skip_make", { requestId });
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
            request_id: requestId,
          };

          const makeResponse = await doFetch(MAKE_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payloadToMake),
          });

          if (!makeResponse.ok) {
            console.error("[payment] make_webhook_failed", {
              requestId,
              status: makeResponse.status,
              statusText: makeResponse.statusText,
              session_id: session.id,
            });
          } else {
            console.log("[payment] make_webhook_ok", { requestId, session_id: session.id });
          }
        }
      }
    } catch (makeError) {
      console.error("[payment] make_error", {
        requestId,
        error: makeError && makeError.message ? makeError.message : String(makeError),
        session_id: session.id,
        email,
      });
      // No bloqueamos el pago por un fallo de Make.
    }

    // --- 7) DEVOLVER URL PARA REDIRIGIR A STRIPE ---
    return json(res, 200, { url: session.url, requestId });
  } catch (error) {
    console.error("[payment] unhandled_error", {
      requestId,
      message: error && error.message ? error.message : String(error),
    });

    return json(res, 500, {
      code: "SERVER_ERROR",
      error: "Error al crear sesión de pago",
      details: error && error.message ? error.message : String(error),
      requestId,
    });
  }
};
