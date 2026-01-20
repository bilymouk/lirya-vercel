/**
 * /api/payment
 * Crea Checkout Session en Stripe + envía a Make un "pedido pendiente" con TODO el formulario.
 * Luego Stripe webhook marcará PAGADO usando stripe_session_id.
 */
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

/* ===================== CORS (opcional pero seguro) ===================== */
function isAllowedOrigin(origin) {
  const allowed = new Set([
    "https://lirya.studio",
    "https://www.lirya.studio",
  ]);
  return allowed.has(origin);
}

function setCors(req, res) {
  const origin = (req.headers.origin || "").toString().trim();
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ===================== Utils ===================== */
function validateEmail(val) {
  const v = String(val || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function clampStr(v, max) {
  const s = String(v || "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function priceFromTarifa(tarifa) {
  if (tarifa === "49") return 4900;
  if (tarifa === "59") return 5900;
  if (tarifa === "79") return 7900;
  return null;
}

function resolveBaseUrl(req) {
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
  if (envUrl) BASE_URL = envUrl.startsWith("http") ? envUrl : `https://${envUrl}`;
  else if (host) BASE_URL = `${proto}://${host}`;
  else if (process.env.VERCEL_URL) BASE_URL = `https://${process.env.VERCEL_URL}`;

  if (!BASE_URL.startsWith("http")) return "";
  return BASE_URL.replace(/\/+$/, "");
}

/* ===================== Handler ===================== */
module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const f = req.body || {};

    // Campos mínimos para Stripe + anti-basura
    const tarifa = clampStr(f.tarifa, 3);          // "49" | "59" | "79"
    const email = clampStr(f.email, 254);
    const recipientName = clampStr(f.recipient_name, 80);

    const amount = priceFromTarifa(tarifa);
    if (!amount) return res.status(400).json({ error: "Tarifa no válida" });
    if (!validateEmail(email)) return res.status(400).json({ error: "Email no válido" });
    if (recipientName.length < 2) return res.status(400).json({ error: "recipient_name no válido" });

    const BASE_URL = resolveBaseUrl(req);
    if (!BASE_URL) return res.status(500).json({ error: "BASE_URL inválida" });

    // ✅ Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,

      billing_address_collection: "required",
      customer_creation: "always",

      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Canción Personalizada Lirya",
              description: `Para ${recipientName} (Plan ${tarifa}€)`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],

      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancel.html`,

      // Metadata mínima (útil para debug y match)
      metadata: {
        email,
        tarifa,
        recipient_name: recipientName,
      },
    });

    // ✅ Enviar a Make un pedido "PENDIENTE" con TODO el formulario + stripe_session_id
    // (no rompemos el pago si Make falla)
    try {
      const MAKE_WEBHOOK_URL_PENDING = (process.env.MAKE_WEBHOOK_URL_PENDING || "").trim();

      if (!MAKE_WEBHOOK_URL_PENDING) {
        console.warn("⚠️ Falta MAKE_WEBHOOK_URL_PENDING en env. Saltando envío a Make (pendiente).");
      } else {
        const payload = {
          ...f, // 👈 IMPORTANTÍSIMO: manda TODO el formulario
          stripe_session_id: session.id,
          estado_pago: "PENDIENTE",
          created_at: new Date().toISOString(),
        };

        const rr = await fetch(MAKE_WEBHOOK_URL_PENDING, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!rr.ok) {
          const t = await rr.text().catch(() => "");
          console.error("❌ Make PENDIENTE no OK:", rr.status, t);
        } else {
          console.log("✅ Enviado a Make (PENDIENTE):", session.id);
        }
      }
    } catch (e) {
      console.error("⚠️ Error enviando a Make (PENDIENTE):", e?.message || e);
    }

    // ✅ Respuesta al front para redirigir
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("❌ ERROR PAYMENT:", error && error.message ? error.message : error);
    return res.status(500).json({ error: "Error al crear sesión de pago" });
  }
};
