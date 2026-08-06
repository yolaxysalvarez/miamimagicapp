// ═══════════════════════════════════════════════════════════════
//  MIAMI MAGIC · Stripe webhook  (versión CommonJS)
//  Ruta en el repo:  api/stripe-webhook.js
//
//  Esta versión NO usa import/export, así funciona en Vercel sin
//  necesidad de package.json ni configuración extra.
//
//  Variables de entorno en Vercel:
//    STRIPE_WEBHOOK_SECRET   → whsec_...
//    SUPABASE_URL            → https://rlhawyyhqhjhwdeghkon.supabase.co
//    SUPABASE_SERVICE_KEY    → llave service_role de Supabase (SECRETA)
//    STRIPE_SECRET_KEY       → opcional, para cancelaciones
// ═══════════════════════════════════════════════════════════════

import crypto from 'crypto';


function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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

  const age = Math.floor(Date.now() / 1000) - parseInt(parts.t, 10);
  if (!Number.isFinite(age) || Math.abs(age) > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(parts.t + '.' + rawBody.toString('utf8'), 'utf8')
    .digest('hex');

  const expBuf = Buffer.from(expected, 'utf8');
  return parts.v1.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  });
}

async function setPremium(email, isPremium, extra) {
  extra = extra || {};
  if (!email) return { ok: false, reason: 'no email' };

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) {
    console.error('[mm] missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return { ok: false, reason: 'missing env' };
  }

  const body = Object.assign(
    { email: String(email).toLowerCase(), premium: !!isPremium },
    isPremium ? { premium_since: new Date().toISOString() } : {},
    extra
  );

  const res = await fetch(base + '/rest/v1/profiles?on_conflict=email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: 'Bearer ' + key,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[mm] supabase write failed', res.status, text);
    return { ok: false, status: res.status };
  }
  return { ok: true };
}

export default async function handler(req, res) {
  // Una visita normal desde el navegador cae aquí — sirve para comprobar que existe
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Method not allowed',
      hint: 'Miami Magic Stripe webhook is alive. It only accepts POST from Stripe.',
    });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'Could not read body' });
  }

  if (!verifyStripeSignature(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) {
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
    if (event.type === 'checkout.session.completed') {
      const email =
        obj.customer_email || (obj.customer_details && obj.customer_details.email) || null;
      await setPremium(email, true, {
        stripe_customer_id: obj.customer || null,
        stripe_subscription_id: obj.subscription || null,
      });
      console.log('[mm] premium ON for', email);

    } else if (event.type === 'invoice.payment_succeeded') {
      const email = obj.customer_email || null;
      if (email) await setPremium(email, true, { stripe_customer_id: obj.customer || null });

    } else if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
      let email = obj.customer_email || null;
      if (!email && obj.customer && process.env.STRIPE_SECRET_KEY) {
        try {
          const cRes = await fetch('https://api.stripe.com/v1/customers/' + obj.customer, {
            headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY },
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
    }
  } catch (e) {
    console.error('[mm] handler error', e);
    // Se responde 200 igual: un error haría que Stripe reintente en bucle
  }

  return res.status(200).json({ received: true });
};

// Stripe firma los bytes exactos del cuerpo — Vercel no debe modificarlo.
export const config = { api: { bodyParser: false } };
