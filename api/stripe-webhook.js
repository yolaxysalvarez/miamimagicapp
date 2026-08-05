// ═══════════════════════════════════════════════════════════════
//  MIAMI MAGIC · Stripe webhook
//  Ruta en el repo:  /api/stripe-webhook.js
//
//  Qué hace: Stripe avisa aquí cuando alguien paga o cancela, se
//  verifica que el aviso venga de verdad de Stripe, y se marca al
//  usuario como premium en Supabase.
//
//  Sin dependencias npm — usa solo el crypto de Node.
//
//  Variables de entorno necesarias en Vercel:
//    STRIPE_WEBHOOK_SECRET   → whsec_... (te lo da Stripe al crear el webhook)
//    SUPABASE_URL            → https://rlhawyyhqhjhwdeghkon.supabase.co
//    SUPABASE_SERVICE_KEY    → la llave "service_role" de Supabase (SECRETA)
// ═══════════════════════════════════════════════════════════════

import crypto from 'crypto';

// Stripe firma el cuerpo EXACTO. Vercel no debe tocarlo.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Verificación de firma equivalente a stripe.webhooks.constructEvent
function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  const parts = {};
  signatureHeader.split(',').forEach((kv) => {
    const [k, v] = kv.split('=');
    if (!k || !v) return;
    if (k.trim() === 'v1') (parts.v1 = parts.v1 || []).push(v.trim());
    else parts[k.trim()] = v.trim();
  });
  if (!parts.t || !parts.v1) return false;

  // Rechaza avisos viejos (protege contra reenvíos maliciosos)
  const age = Math.floor(Date.now() / 1000) - parseInt(parts.t, 10);
  if (!Number.isFinite(age) || Math.abs(age) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody.toString('utf8')}`, 'utf8')
    .digest('hex');

  const expBuf = Buffer.from(expected, 'utf8');
  return parts.v1.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  });
}

async function setPremium(email, isPremium, extra = {}) {
  if (!email) return { ok: false, reason: 'no email' };

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) return { ok: false, reason: 'missing supabase env' };

  const body = {
    email: email.toLowerCase(),
    premium: isPremium,
    ...(isPremium ? { premium_since: new Date().toISOString() } : {}),
    ...extra,
  };

  // on_conflict=email → crea la fila si el pago llegó antes que el registro
  const res = await fetch(
    `${base}/rest/v1/profiles?on_conflict=email`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error('[mm] supabase write failed', res.status, text);
    return { ok: false, status: res.status, text };
  }
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Could not read body' });
  }

  const sig = req.headers['stripe-signature'];
  if (!verifyStripeSignature(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)) {
    console.warn('[mm] rejected: bad stripe signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const obj = (event.data && event.data.object) || {};

  try {
    switch (event.type) {
      // El pago se completó → activar
      case 'checkout.session.completed': {
        const email =
          obj.customer_email ||
          (obj.customer_details && obj.customer_details.email) ||
          null;
        await setPremium(email, true, {
          stripe_customer_id: obj.customer || null,
          stripe_subscription_id: obj.subscription || null,
        });
        console.log('[mm] premium ON for', email);
        break;
      }

      // Renovación mensual exitosa → mantener activo
      case 'invoice.payment_succeeded': {
        const email = obj.customer_email || null;
        if (email) await setPremium(email, true, { stripe_customer_id: obj.customer || null });
        break;
      }

      // Cancelación, impago o suscripción vencida → desactivar
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        let email = obj.customer_email || null;
        // Las suscripciones no siempre traen el correo: se pide el cliente
        if (!email && obj.customer && process.env.STRIPE_SECRET_KEY) {
          try {
            const cRes = await fetch(`https://api.stripe.com/v1/customers/${obj.customer}`, {
              headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            });
            if (cRes.ok) {
              const c = await cRes.json();
              email = c.email || null;
            }
          } catch (e) {
            console.error('[mm] could not fetch customer', e);
          }
        }
        if (email) {
          await setPremium(email, false, { premium_until: new Date().toISOString() });
          console.log('[mm] premium OFF for', email);
        }
        break;
      }

      default:
        // Otros eventos se ignoran a propósito
        break;
    }
  } catch (e) {
    console.error('[mm] handler error', e);
    // 200 igual: si devolvemos error, Stripe reintenta en bucle
  }

  return res.status(200).json({ received: true });
}
