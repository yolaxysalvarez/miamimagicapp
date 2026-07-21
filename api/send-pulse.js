// /api/send-pulse.js
// Vercel Cron target — corre solo (sin que nadie tenga el app abierta),
// calcula las alertas de Miami Pulse del momento y manda push reales
// a cada suscriptor, respetando sus preferencias de categoría e idioma.
//
// Variables de entorno necesarias en Vercel:
//   SUPABASE_URL             = https://rlhawyyhqhjhwdeghkon.supabase.co
//   SUPABASE_SERVICE_ROLE    = (llave service_role — SECRETA)
//   VAPID_PUBLIC_KEY         = (la pública que Claude generó)
//   VAPID_PRIVATE_KEY        = (la privada — SECRETA)
//   VAPID_CONTACT_EMAIL      = mailto:tu-correo@ejemplo.com
//
// Requiere el paquete "web-push" en package.json (ver nota al final).

const webpush = require('web-push');

const MIA_SUNSET = [[17,50],[18,12],[19,32],[19,48],[20,2],[20,14],[20,15],[19,58],[19,28],[18,52],[17,34],[17,29]];
const MIA_SUNRISE = [[7,8],[6,57],[7,28],[6,52],[6,32],[6,28],[6,40],[6,56],[7,10],[7,24],[6,44],[7,0]];

function moonAge(d) {
  const ref = Date.UTC(2000,0,6,18,14);
  let days = (d.getTime() - ref) / 86400000;
  let age = days % 29.53059;
  if (age < 0) age += 29.53059;
  return age;
}

async function fetchWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=25.77&longitude=-80.19'
    + '&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relativehumidity_2m,uv_index'
    + '&hourly=precipitation_probability'
    + '&daily=uv_index_max&temperature_unit=fahrenheit&windspeed_unit=mph'
    + '&timezone=America/New_York&forecast_days=2';
  const r = await fetch(url);
  const data = await r.json();
  const c = data.current;
  const hn = new Date().getHours();
  let rain3h = 0;
  if (data.hourly && data.hourly.precipitation_probability) {
    for (let k = hn; k < Math.min(hn + 3, data.hourly.precipitation_probability.length); k++) {
      rain3h = Math.max(rain3h, data.hourly.precipitation_probability[k] || 0);
    }
  }
  return {
    temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weathercode,
    wind: c.windspeed_10m, hum: c.relativehumidity_2m,
    uv: c.uv_index != null ? c.uv_index : (data.daily?.uv_index_max?.[0] || 0),
    rain3h
  };
}

async function fetchLiveEvents() {
  // Reutiliza el dataset real del app en producción (una sola fuente de verdad)
  try {
    const r = await fetch('https://miamimagicapp.com/', { cache: 'no-store' });
    const html = await r.text();
    const m = html.match(/events\s*:\s*\[/);
    if (!m) return [];
    let i = m.index + m[0].length - 1, depth = 0, start = i;
    for (; i < html.length; i++) {
      if (html[i] === '[') depth++;
      else if (html[i] === ']') { depth--; if (depth === 0) break; }
    }
    const arrText = '[' + html.slice(start + 1, i);
    // eval controlado: el propio dataset del app, no input de usuario
    // eslint-disable-next-line no-new-func
    const events = Function('"use strict"; return (' + arrText + ')')();
    return events;
  } catch (e) { return []; }
}

const JOKES_ES = [
  'Pronóstico de peinado: la humedad gana hoy. Acéptalo con dignidad — el frizz aquí es un estilo de vida.',
  'Lección de español miamense: "ahorita" puede ser en 5 minutos, en 3 horas o nunca.',
  'Dato local: encontrar parking en Wynwood un sábado cuenta como logro deportivo.',
  'Regla de oro: si llueve en Miami, espera 20 minutos. Si no llueve… espera 20 minutos también.',
  'Recordatorio de bienestar: caminar del carro a la playa cuenta como cardio.',
  'El invierno oficial de Miami vive en los restaurantes con el A/C al máximo. Lleva suéter.',
  'Las gafas de sol aquí no son accesorio: son equipo de protección.',
  'PSA gastronómico: no existe mal momento para una croqueta.',
  '"Salgo en 5 minutos" en Miami es una expresión de cariño, no un compromiso de tiempo.',
  'La ventanita es la red social original de Miami: noticias, chismes y cortaditos.'
];
const JOKES_EN = [
  'Hairstyle forecast: humidity wins today. Accept it with dignity — frizz here is a lifestyle.',
  'Miami Spanish lesson: "ahorita" can mean in 5 minutes, in 3 hours, or never.',
  'Local fact: finding parking in Wynwood on a Saturday counts as an athletic achievement.',
  'Golden rule: if it rains in Miami, wait 20 minutes. If it doesn\'t… also wait 20 minutes.',
  'Wellness reminder: walking from your car to the beach counts as cardio.',
  'Miami\'s official winter lives inside restaurants with the A/C on max. Bring a sweater.',
  'Sunglasses here aren\'t an accessory: they\'re protective equipment.',
  'Food PSA: there is no wrong time for a croqueta.',
  '"Leaving in 5 minutes" in Miami is a term of endearment, not a time commitment.',
  'The ventanita is Miami\'s original social network: news, gossip and cortaditos.'
];

function buildCandidates(now, wx, events) {
  const H = now.getHours() + now.getMinutes() / 60;
  const dow = now.getDay(), mo = now.getMonth();
  const C = [];
  const add = (id, score, cat, tagEs, tagEn, msgEs, msgEn, url) =>
    C.push({ id, score, cat, tagEs, tagEn, msgEs, msgEn, url: url || '/' });

  // CIELO
  const sr = MIA_SUNRISE[mo], srT = new Date(now); srT.setHours(sr[0], sr[1], 0, 0);
  const srMin = Math.round((srT - now) / 60000);
  if (srMin > 0 && srMin <= 45) add('sunrise', 85, 'cielo',
    `Amanecer en ${srMin} min`, `Sunrise in ${srMin} min`,
    'El Atlántico se enciende primero en Sunny Isles y South Pointe.',
    'The Atlantic lights up first at Sunny Isles and South Pointe.');
  const ss = MIA_SUNSET[mo], ssT = new Date(now); ssT.setHours(ss[0], ss[1], 0, 0);
  const ssMin = Math.round((ssT - now) / 60000);
  const hh = `${ss[0] > 12 ? ss[0] - 12 : ss[0]}:${String(ss[1]).padStart(2,'0')} PM`;
  if (ssMin > 0 && ssMin <= 75) add('golden', 90, 'cielo',
    `Golden hour · atardece ${hh}`, `Golden hour · sunset ${hh}`,
    'El cielo de Miami entra en modo show. Es AHORA.', 'Miami\'s sky goes full show mode. It\'s NOW.', '/#sec-june');
  const age = moonAge(now);
  if (age >= 13.8 && age <= 15.8 && H >= 18) add('moon', 65, 'cielo',
    'Luna llena esta noche', 'Full moon tonight',
    'La bahía con luna llena es otro Miami.', 'The bay under a full moon is a different Miami.');

  // CLIMA
  if (wx) {
    if (wx.rain3h >= 60) add('rain', 95, 'clima', 'Chubasco probable pronto', 'Rain likely soon',
      'Típico de Miami: cae fuerte 20 minutos y vuelve el sol.', 'Classic Miami: 20 hard minutes then sun again.');
    if (wx.uv >= 8 && H >= 10 && H < 16) add('uv', 75, 'clima', `UV ${Math.round(wx.uv)} · muy alto`, `UV ${Math.round(wx.uv)} · very high`,
      'Protector cada 2 horas, sombra al mediodía.', 'Sunscreen every 2 hours, shade at noon.');
    if (wx.feels >= 100 && H >= 11 && H < 17 && wx.rain3h < 60) add('heat', 72, 'clima',
      `Sensación de ${Math.round(wx.feels)}°F`, `Feels like ${Math.round(wx.feels)}°F`,
      'Hidrátate como local: agua de coco y sombra.', 'Hydrate like a local: coconut water and shade.');
  }

  // RITMOS
  if (dow >= 1 && dow <= 5) {
    if (H >= 7 && H < 9.5) add('rushAM', 70, 'ritmos', 'Hora pico matutina', 'Morning rush hour',
      'La I-95 y la Palmetto van lentas hasta las 9:30.', 'I-95 and the Palmetto crawl until 9:30.');
    if (H >= 16 && H < 19) add('rushPM', 70, 'ritmos', 'Hora pico de la tarde', 'Evening rush hour',
      'De 4 a 7 la I-95 y la US-1 se ponen pesadas.', '4–7pm I-95 and US-1 get heavy.');
  }

  // EVENTOS
  const t0 = new Date(now); t0.setHours(0,0,0,0);
  let tonight = null, gameday = null;
  (events || []).forEach(ev => {
    if (!ev.d) return;
    const p = ev.d.split('-'); const d = new Date(+p[0], +p[1]-1, +p[2]);
    const p2 = (ev.d2 || ev.d).split('-'); const d2 = new Date(+p2[0], +p2[1]-1, +p2[2]);
    const starts = d.getTime() === t0.getTime();
    const active = d <= t0 && d2 >= t0;
    const vn = (ev.venue || '') + ' ' + (ev.type || '');
    const isBig = /stadium|arena|kaseya|hard rock|loandepot|amerant/i.test(vn);
    if (active && starts && !tonight) tonight = ev;
    if (active && isBig && !gameday) gameday = ev;
  });
  if (gameday && H >= 13 && H < 20) add('gameday', 80, 'eventos', 'Evento grande hoy', 'Big event today',
    `Hoy: ${gameday.name_es || gameday.name} en ${gameday.venue_es || gameday.venue}. Llega temprano.`,
    `Today: ${gameday.name} at ${gameday.venue}. Arrive early.`, '/#sec-june');
  if (tonight && H >= 16 && H < 23 && (!gameday || tonight.id !== gameday.id))
    add('tonight', 78, 'eventos', 'Esta noche en Miami', 'Tonight in Miami',
      `${tonight.name_es || tonight.name} · ${tonight.venue_es || tonight.venue}`,
      `${tonight.name} · ${tonight.venue}`, '/#sec-june');

  // SABORES
  const md = (mo + 1) * 100 + now.getDate();
  if (md === 729 || md === 730) add('lobster', 88, 'sabores', 'Mini-temporada de langosta', 'Lobster mini-season',
    'Las 48 horas más sabrosas de Florida.', 'Florida\'s tastiest 48 hours.');
  if (mo >= 5 && mo <= 7 && H >= 9 && H < 18) add('mango', 35, 'sabores', 'Temporada de mango', 'Mango season',
    'Miami huele a mango en los farmers markets.', 'Miami smells like mango at farmers markets.');

  // HUMOR
  if (H >= 15 && H < 16) add('cafecito', 68, 'humor', 'Hora del cafecito · 3:05', 'Cafecito time · 3:05',
    '3:05 PM — hora oficial del cafecito en el 305.', '3:05 PM — official cafecito time in the 305.');
  const doy = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
  if (H >= 9 && H < 23) {
    const idx = doy % JOKES_ES.length;
    add('joke' + idx, (doy % 3 === 0) ? 58 : 30, 'humor', 'Solo en Miami', 'Only in Miami',
      JOKES_ES[idx], JOKES_EN[idx]);
  }

  return C;
}

module.exports = async function handler(req, res) {
  // Protege el endpoint: solo Vercel Cron (o quien tenga el secreto) puede dispararlo
  const auth = req.headers['authorization'];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_CONTACT_EMAIL || 'mailto:hola@miamimagicapp.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

    const [wx, events] = await Promise.all([fetchWeather(), fetchLiveEvents()]);
    const now = new Date();
    const candidates = buildCandidates(now, wx, events);

    const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=*`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }
    });
    const subs = await subsRes.json();

    let sent = 0, failed = 0, removed = 0;

    for (const sub of subs) {
      const filtered = candidates.filter(c => sub[`pref_${c.cat}`] !== false);
      if (!filtered.length) continue;
      filtered.sort((a, b) => b.score - a.score);
      const top = filtered[0];
      const ES = sub.lang !== 'en';

      const payload = JSON.stringify({
        title: (ES ? top.tagEs : top.tagEn) + ' 🌴',
        body: ES ? top.msgEs : top.msgEn,
        url: top.url
      });

      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key }
      };

      try {
        await webpush.sendNotification(pushSub, payload);
        sent++;
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${sub.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`
          },
          body: JSON.stringify({ last_sent_at: now.toISOString() })
        });
      } catch (err) {
        failed++;
        // 410/404 = suscripción muerta (usuario desinstaló) → limpiar
        if (err.statusCode === 410 || err.statusCode === 404) {
          await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${sub.id}`, {
            method: 'DELETE',
            headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }
          });
          removed++;
        }
      }
    }

    return res.status(200).json({ ok: true, candidatos: candidates.length, suscriptores: subs.length, enviados: sent, fallidos: failed, limpiados: removed });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

// ── NOTA DE INSTALACIÓN ──
// 1) En tu repo, dentro de package.json agrega la dependencia "web-push":
//      npm install web-push
//    Si no tienes package.json en la raíz del repo, Claude te da uno abajo.
// 2) Este archivo va en /api/send-pulse.js (junto a tu chat.js existente).
// 3) Configura el cron en vercel.json (ver archivo vercel-cron-snippet.json).
