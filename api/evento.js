// Vista previa propia para los eventos compartidos (?ev=ID), en News y en la app:
// título del evento, lugar y fecha, y su foto, para WhatsApp, Facebook, X y demás.
// La página que recibe la persona es la misma de siempre: abre la ficha del evento.
const SITE = 'https://www.miamimagicapp.com';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function setMeta(html, attr, key, val) {
  const re = new RegExp('<meta ' + attr + '="' + key + '" content="[^"]*"\\s*/?>', 'i');
  const tag = '<meta ' + attr + '="' + key + '" content="' + esc(val) + '">';
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', tag + '\n</head>');
}
function corto(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const c = s.slice(0, n);
  return c.slice(0, Math.max(c.lastIndexOf(' '), n - 20)).replace(/[,;:·\-–\s]+$/, '') + '…';
}

export default async function handler(req, res) {
  const q = req.query || {};
  const id = String(q.ev || q.id || '').slice(0, 120);
  const app = q.page === 'app';
  const en = q.lang === 'en';
  const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.miamimagicapp.com');
  const pagina = app ? '/index.html' : '/noticias.html';
  const vuelta = (app ? '/index.html?' : (en ? '/noticias.html?lang=en&' : '/noticias.html?')) + 'ev=' + encodeURIComponent(id);
  try {
    const [hr, er] = await Promise.all([fetch(base + pagina), fetch(base + '/eventos.json')]);
    if (!hr.ok) throw new Error('html ' + hr.status);
    let html = await hr.text();
    let e = null;
    if (er.ok && id) {
      const d = await er.json();
      for (const k of ['semana', 'mes', 'proximos', 'anuales']) {
        e = (d[k] || []).find(x => x && x.id === id);
        if (e) break;
      }
    }
    if (e) {
      const nm = (en ? e.name : (e.name_es || e.name)) || 'Miami Magic';
      const ve = (en ? e.venue : (e.venue_es || e.venue)) || '';
      const tm = (en ? e.time : (e.time_es || e.time)) || '';
      const ds = (en ? e.desc : (e.desc_es || e.desc)) || '';
      const desc = corto([ve, tm].filter(Boolean).join(' · ') + (ds ? '. ' + ds : ''), 190);
      const f = e.photo || '';
      const img = f ? (/^https?:/.test(f) ? f : SITE + '/' + f.replace(/^\/+/, '')) : SITE + '/og-share.jpg';
      const url = SITE + (app ? '/' : (en ? '/news' : '/noticias')) + '?ev=' + encodeURIComponent(id);
      const title = nm + (app ? ' · Miami Magic' : ' · Miami Magic News');
      html = html.replace(/<title>[^<]*<\/title>/i, '<title>' + esc(title) + '</title>');
      html = setMeta(html, 'name', 'description', desc);
      html = setMeta(html, 'property', 'og:title', nm);
      html = setMeta(html, 'property', 'og:description', desc);
      html = setMeta(html, 'property', 'og:image', img);
      html = setMeta(html, 'property', 'og:url', url);
      html = setMeta(html, 'property', 'og:type', 'website');
      html = setMeta(html, 'name', 'twitter:card', 'summary_large_image');
      html = setMeta(html, 'name', 'twitter:title', nm);
      html = setMeta(html, 'name', 'twitter:description', desc);
      html = setMeta(html, 'name', 'twitter:image', img);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    res.status(200).send(html);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(302, { Location: vuelta });
    res.end();
  }
}
