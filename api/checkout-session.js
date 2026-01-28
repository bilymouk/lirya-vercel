import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  try {
    const session_id = String(req.query.session_id || "").trim();
    if (!session_id) return res.status(400).json({ error: "session_id requerido" });

    const session = await stripe.checkout.sessions.retrieve(session_id);

    const amount_total = session.amount_total || 0;
    const currency = (session.currency || "eur").toUpperCase();

    return res.status(200).json({
      session_id,
      amount_total,
      value: amount_total / 100,
      currency,
      payment_status: session.payment_status || "",
      metadata: { ...(session.metadata || {}) }, // ✅ más seguro
    });
  } catch (err) {
    console.error("❌ checkout-session error:", err);
    return res.status(500).json({
      error: "No se pudo leer checkout-session",
      details: String(err?.message || err),
    });
  }
}
