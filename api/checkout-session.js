import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const ALLOWED_ORIGINS = [
  "https://lirya.studio",
  "https://www.lirya.studio",
];

export default async function handler(req, res) {
  // --- CORS + headers ---
  const origin = req.headers.origin;

  // Si viene origin y está permitido, lo devolvemos.
  // Si no viene origin (casos típicos de navegación), NO bloqueamos.
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

  try {
    const session_id = String(req.query.session_id || "").trim();
    if (!session_id) {
      return res.status(400).json({ error: "session_id requerido" });
    }

    // ✅ validación mínima: evita basura / inputs raros
    // Stripe suele usar cs_test_... o cs_live_...
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(session_id)) {
      return res.status(400).json({ error: "session_id inválido" });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    const amount_total = Number(session.amount_total || 0);
    const value = amount_total / 100;
    const currency = String(session.currency || "eur").toUpperCase();
    const payment_status = String(session.payment_status || "");

    // ✅ Respuesta MINIMALISTA (lo necesario para pintar el success sin filtrar metadata)
    return res.status(200).json({
      session_id: session.id,
      payment_status, // "paid" es lo que te interesa
      value,
      currency,
      // opcional (por si quieres mostrarlo o debug ligero):
      customer_email: session.customer_email || "",
    });
  } catch (err) {
    console.error("❌ checkout-session error:", err);

    // Stripe a veces devuelve statusCode dentro del error
    const status = Number(err?.statusCode || 500);

    return res.status(status).json({
      error: "No se pudo leer checkout-session",
      details: String(err?.message || err),
    });
  }
}
