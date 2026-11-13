// Sirve la página de una nota con su propia vista previa (título, bajada y foto)
// para Facebook, WhatsApp, X y demás. Si algo falla, manda a la página normal.
const SITE = 'https://www.miamimagicapp.com';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function hoyNY() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // AAAA-MM-DD
}
function setMeta(html, attr, key, val) {
  const re = new RegExp('<meta ' + attr + '="' + key + '" content="[^"]*">', 'i');
  const tag = '<meta ' + attr + '="' + key + '" content="' + esc(val) + '">';
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', tag + '\n</head>');
}

export default async function handler(req, res) {
  const q = req.query || {};
  const id = String(q.id || '').replace(/[^a-z0-9\-_]/gi, '');
  const en = q.lang === 'en';
  const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.miamimagicapp.com');
  const fallback = '/noticias-nota.html?id=' + encodeURIComponent(id) + (en ? '&lang=en' : '');
  try {
    const [hr, dr] = await Promise.all([fetch(base + '/noticias-nota.html'), fetch(base + '/noticias.json')]);
    if (!hr.ok) throw new Error('html ' + hr.status);
    let html = await hr.text();
    let n = null;
    if (dr.ok) {
      const d = await dr.json();
      n = (d.notas || []).find(x => x.id === id) || null;
      if (n && n.fecha && n.fecha > hoyNY()) n = null; // nada de adelantar notas programadas
    }
    if (n) {
      const L = (en && n.en) ? n.en : n.es;
      const title = L.titulo || 'Miami Magic News';
      const desc = L.bajada || 'Miami Magic News · Lo que mueve a Miami y los Cayos.';
      const f = (en && n.foto_en) ? n.foto_en : n.foto;
      const img = f ? (/^https?:/.test(f) ? f : SITE + '/fotos/' + f.replace(/^\/?(fotos\/)?/, '')) : SITE + '/og-share.jpg';
      const url = SITE + (en ? '/news/' : '/noticias/') + id;
      html = html.replace(/<title>[^<]*<\/title>/i, '<title>' + esc(title) + ' · Miami Magic News</title>');
      html = setMeta(html, 'name', 'description', desc);
      html = setMeta(html, 'property', 'og:title', title);
      html = setMeta(html, 'property', 'og:description', desc);
      html = setMeta(html, 'property', 'og:image', img);
      html = setMeta(html, 'property', 'og:url', url);
      html = setMeta(html, 'property', 'og:locale', en ? 'en_US' : 'es_US');
      html = setMeta(html, 'name', 'twitter:title', title);
      html = setMeta(html, 'name', 'twitter:description', desc);
      html = setMeta(html, 'name', 'twitter:image', img);
      if (en) html = html.replace('<html lang="es">', '<html lang="en">');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    res.status(200).send(html);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(302, { Location: fallback });
    res.end();
  }
}
