import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

export default async function handler(req, res) {
  // --- CORS + headers ---
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  // ===== RATE LIMITING =====
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "");

  if (!checkRateLimit(ip)) {
    console.warn(`⚠️ Rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({ error: "Demasiadas solicitudes" });
  }

  try {
    const session_id = String(req.query.session_id || "").trim();
    if (!session_id) {
      return res.status(400).json({ error: "session_id requerido" });
    }

    // Validación: cs_test_ o cs_live_
    if (!session_id.startsWith("cs_test_") && !session_id.startsWith("cs_live_")) {
      return res.status(400).json({ error: "session_id inválido" });
    }

    // Validar longitud
    if (session_id.length < 20 || session_id.length > 200) {
      return res.status(400).json({ error: "session_id longitud inválida" });
    }

    console.log(`📋 Retrieving checkout session: ${session_id.slice(0, 24)}...`);

    // Timeout wrapper
    const retrieveWithTimeout = (sessionId, timeout = 8000) => {
      return Promise.race([
        stripe.checkout.sessions.retrieve(sessionId, {
          expand: ["line_items", "line_items.data.price.product"],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout)),
      ]);
    };

    const session = await retrieveWithTimeout(session_id);

    // Verificar si expiró
    if (session.status === "expired") {
      return res.status(410).json({
        error: "La sesión ha expirado",
        expired: true,
      });
    }

    const amount_total = Number(session.amount_total || 0);
    const value = amount_total / 100;

    const currency = String(session.currency || "eur").toUpperCase();
    const payment_status = String(session.payment_status || "");

    // Productos
    const lineItems = session.line_items?.data || [];
    const products = lineItems.map((item) => ({
      name: item.price?.product?.name || item.description || "",
      quantity: Number(item.quantity || 1),
      amount: Number(item.amount_total || 0) / 100,
    }));

    console.log(`✅ Session retrieved: ${payment_status} | ${value} ${currency}`);

    return res.status(200).json({
      session_id: session.id,
      payment_status,
      value,
      currency,
      customer_email: session.customer_email || "",
      customer_name: session.customer_details?.name || "",
      order_number: session.metadata?.order_number || "",
      created: session.created,
      payment_intent: session.payment_intent || null,
      products,
    });
  } catch (err) {
    if (err?.message === "Timeout") {
      console.error("⏱️ Timeout retrieving session");
      return res.status(504).json({
        error: "Timeout al recuperar la sesión",
      });
    }

    console.error("❌ checkout-session error:", {
      error: err?.message,
      statusCode: err?.statusCode,
    });

    const status = Number(err?.statusCode || 500);

    return res.status(status).json({
      error: "No se pudo leer checkout-session",
      details: String(err?.message || err),
    });
  }
}
