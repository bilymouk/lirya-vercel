const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS (mismo estilo que tu payment)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const session_id = (req.query.session_id || "").toString().trim();
    if (!session_id) return res.status(400).json({ error: "session_id requerido" });

    // Recupera la sesión de Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);

    // amount_total viene en céntimos
    const amount_total = session.amount_total || 0;
    const currency = (session.currency || "eur").toUpperCase();

    // Si quieres: metadata útil
    const tarifa = session.metadata?.tarifa || "";
    const recipient_name = session.metadata?.recipient_name || "";

    return res.status(200).json({
      session_id,
      amount_total,               // 4900 / 5900 / 7900
      value: amount_total / 100,  // 49 / 59 / 79
      currency,                   // "EUR"
      tarifa,
      recipient_name
    });
  } catch (err) {
    console.error("❌ ERROR checkout-session:", err);
    return res.status(500).json({
      error: "No se pudo recuperar la sesión",
      details: err && err.message ? err.message : String(err),
    });
  }
};
