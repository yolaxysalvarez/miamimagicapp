export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { msg, lang, history } = await req.json();

    const sys = lang === 'es'
      ? 'Eres el concierge de Miami Magic. Das consejos cortos, entusiastas y practicos sobre Miami: restaurantes, playas, vida nocturna, hoteles, eventos, barrios, secretos locales. Maximo 80 palabras. Usa emojis. Responde en espanol.'
      : 'You are the Miami Magic concierge. Give short, enthusiastic, practical advice about Miami: restaurants, beaches, nightlife, hotels, events, neighborhoods, hidden gems. Max 80 words. Use emojis.';

    const messages = [...(history || []), { role: 'user', content: msg }];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: sys,
        messages
      })
    });

    const data = await res.json();
    const reply = data?.content?.[0]?.text || null;

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ reply: null }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
