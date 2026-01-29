import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const ALLOWED_ORIGINS = [
  "https://lirya.studio",
  "https://www.lirya.studio",
];

export default async function handler(req, res) {
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.includes(origin)) {
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
    if (!session_id) return res.status(400).json({ error: "session_id requerido" });

    // ✅ validación mínima (evita basura)
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(session_id)) {
      return res.status(400).json({ error: "session_id inválido" });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    const amount_total = session.amount_total || 0;
    const currency = (session.currency || "eur").toUpperCase();

    return res.status(200).json({
      session_id: session.id,
      amount_total,
      value: amount_total / 100,
      currency,
      payment_status: session.payment_status || "",
      customer_email: session.customer_email || "",
      metadata: { ...(session.metadata || {}) },
    });
  } catch (err) {
    console.error("❌ checkout-session error:", err);
    return res.status(500).json({
      error: "No se pudo leer checkout-session",
      details: String(err?.message || err),
    });
  }
}
