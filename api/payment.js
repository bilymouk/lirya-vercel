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

async function postToMake(url, payload) {
  if (!url) return { skipped: true, reason: "missing_url" };

  // Node 18+ en Vercel tiene fetch global. Si no, fallará y lo veremos en logs.
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await r.text().catch(() => "");
  if (!r.ok) {
    const err = new Error(`Make webhook failed (${r.status}): ${text}`);
    err.status = r.status;
    throw err;
  }

  return { ok: true, status: r.status, text };
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const f = req.body || {};

    const tarifa = clampStr(f.tarifa, 3);
    const email = clampStr(f.email, 254);
    const recipientName = clampStr(f.recipient_name, 80);

    const amount = priceFromTarifa(tarifa);
    if (!amount) return res.status(400).json({ error: "Tarifa no válida" });
    if (!validateEmail(email)) return res.status(400).json({ error: "Email no válido" });
    if (recipientName.length < 2) return res.status(400).json({ error: "recipient_name no válido" });

    const BASE_URL = resolveBaseUrl(req);
    if (!BASE_URL) return res.status(500).json({ error: "BASE_URL inválida" });

    // 1) Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      billing_address_collection: "required",

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

      // ✅ metadata mínima pero útil
      metadata: {
        email,
        tarifa,
        recipient_name: recipientName,
      },
    });

    // 2) Enviar a Make "PENDIENTE" con el formulario + stripe_session_id
    //    Esto es lo que te rellena Airtable ANTES del pago.
    const pendingUrl = (process.env.MAKE_WEBHOOK_URL_PENDING || "").trim();

    // ⚠️ Importante: guardas el form completo aquí, y luego Make lo podrá actualizar a PAGADO con el webhook
    const pendingPayload = {
      ...f,
      stripe_session_id: session.id,
      estado_pago: "PENDIENTE",
      created_at: new Date().toISOString(),
    };

    // Si Make falla, NO rompas el pago: cobra igual.
    // Pero lo LOGUEAMOS para debug.
    try {
      await postToMake(pendingUrl, pendingPayload);
      console.log("✅ Make PENDING enviado", session.id);
    } catch (e) {
      console.error("⚠️ Make PENDING falló:", e.message || e);
    }

    return res.status(200).json({ url: session.url, session_id: session.id });
  } catch (error) {
    console.error("❌ ERROR PAYMENT:", error && error.message ? error.message : error);
    return res.status(500).json({ error: "Error al crear sesión de pago" });
  }
};
