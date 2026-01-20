const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

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

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    // ✅ FIX: Vercel puede entregar req.body como string
    let f = req.body;
    if (typeof f === "string") {
      try {
        f = JSON.parse(f);
      } catch {
        f = {};
      }
    }
    if (!f || typeof f !== "object") f = {};

    // ✅ Log útil (temporal). Luego lo quitas si quieres.
    console.log("✅ /api/payment body keys:", Object.keys(f));
    console.log("✅ tarifa/email:", f.tarifa, f.email);

    const tarifa = clampStr(f.tarifa, 3);
    const email = clampStr(f.email, 254);
    const recipientName = clampStr(f.recipient_name, 80);

    const amount = priceFromTarifa(tarifa);
    if (!amount) return res.status(400).json({ error: "Tarifa no válida" });

    if (!validateEmail(email)) return res.status(400).json({ error: "Email no válido" });

    if (recipientName.length < 2) {
      return res.status(400).json({ error: "recipient_name no válido" });
    }

    const BASE_URL = resolveBaseUrl(req);
    if (!BASE_URL) return res.status(500).json({ error: "BASE_URL inválida" });

    const session = await stripe.checkout.sessions.create({
      // payment_method_types ya no es obligatorio en APIs nuevas, pero no molesta
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

      metadata: {
        email,
        tarifa,
        recipient_name: recipientName,
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("❌ ERROR PAYMENT:", error && error.message ? error.message : error);
    return res.status(500).json({ error: "Error al crear sesión de pago" });
  }
};
