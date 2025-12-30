import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  try {
    const response = await resend.emails.send({
      from: "Lirya <onboarding@resend.dev>",
      to: "proyectosbily@gmail.com",
      subject: "✅ Prueba Resend Lirya",
      html: "<h2>Resend funciona correctamente 🚀</h2><p>Si lees esto, ya podemos seguir.</p>",
    });

    return res.status(200).json({ success: true, response });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
