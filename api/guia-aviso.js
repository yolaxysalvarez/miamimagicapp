// Aviso por correo a Yoly cuando alguien descarga la guía del comprador.
// Solo envía si existen RESEND_API_KEY y GUIA_AVISO_EMAIL en Vercel; si faltan, no hace nada.
// El registro del lector ya quedó guardado en Supabase desde la página: esto es solo el aviso.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const key = process.env.RESEND_API_KEY, to = process.env.GUIA_AVISO_EMAIL;
  if (!key || !to) return res.status(204).end();
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(email)) return res.status(400).end();
  const lang = b.lang === 'en' ? 'inglés' : 'español';
  const pres = { 'lt500k': 'Hasta $500,000', '500k-1m': 'De $500,000 a $1 millón', 'gt1m': 'Más de $1 millón', 'lt1m': 'Menos de $1 millón', '1-3m': 'De $1 a $3 millones', 'gt3m': 'Más de $3 millones' }[b.budget] || 'No lo indicó';
  const cuando = new Intl.DateTimeFormat('es-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' }).format(new Date());
  const text = 'Alguien descargó la guía "Comprar en Miami y los Cayos".\n\n'
    + 'Correo: ' + email + '\n'
    + 'Presupuesto: ' + pres + '\n'
    + 'Idioma de la página: ' + lang + '\n'
    + 'Cuándo: ' + cuando + ' (hora de Miami)\n\n'
    + 'Aceptó que le escribas por correo sobre bienes raíces. Puedes responder a este mensaje para escribirle.';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Miami Magic <onboarding@resend.dev>', to: [to], reply_to: email, subject: 'Nueva descarga de la guía: ' + email, text })
    });
  } catch (e) { /* el aviso es secundario: nunca rompe la descarga */ }
  return res.status(204).end();
}
