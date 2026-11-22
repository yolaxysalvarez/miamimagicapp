// Vista previa propia para las fichas compartidas (/?item=ID&type=TIPO):
// nombre del lugar, su descripción y su foto, para WhatsApp, Facebook, X y demás.
// Antes salía siempre la foto general de la app, porque esas redes no ejecutan
// el código de la página: solo leen las etiquetas og: del HTML que reciben.
// La página que recibe la persona es la misma de siempre y abre la ficha.
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
  s = String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const c = s.slice(0, n);
  return c.slice(0, Math.max(c.lastIndexOf(' '), n - 20)).replace(/[,;:·\-–\s]+$/, '') + '…';
}
function abs(f) {
  f = String(f || '');
  if (!f || /^data:/.test(f) || /youtu/.test(f)) return '';
  // Las fotos de Unsplash vienen pedidas pequeñas (500 px) para la app; la vista previa necesita más
  if (/images\.unsplash\.com/.test(f)) f = f.replace(/([?&])w=\d+/, '$1w=1200');
  return /^https?:/.test(f) ? f : SITE + '/' + f.replace(/^\/+/, '');
}
function override(sitios, id) {
  // sitios.json corrige fichas sin pasar por Apple: se busca el id en todas sus secciones
  if (!sitios) return null;
  for (const k of Object.keys(sitios)) {
    if (k.charAt(0) === '_') continue;
    const sec = sitios[k];
    if (sec && typeof sec === 'object' && !Array.isArray(sec) && sec[id] && typeof sec[id] === 'object') return sec[id];
  }
  return null;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const id = String(q.item || '').slice(0, 80);
  const type = String(q.type || '').slice(0, 30);
  const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.miamimagicapp.com');
  const vuelta = '/index.html?item=' + encodeURIComponent(id) + (type ? '&type=' + encodeURIComponent(type) : '');
  try {
    const [hr, fr, sr] = await Promise.all([
      fetch(base + '/index.html'),
      fetch(base + '/fichas-share.json'),
      fetch(base + '/sitios.json').catch(() => null)
    ]);
    if (!hr.ok) throw new Error('html ' + hr.status);
    let html = await hr.text();
    let f = null;
    if (fr.ok && id) {
      const d = await fr.json();
      f = (d.fichas || {})[id] ? Object.assign({}, d.fichas[id]) : null;
    }
    let s = null;
    try { if (sr && sr.ok) s = await sr.json(); } catch (e) {}
    const o = override(s, id);
    if (o) {
      f = f || {};
      if (o.active === false) f = null;
      else {
        if (o.name) f.n = o.name;
        if (o.name_es) f.ne = o.name_es;
        if (o.desc) f.d = o.desc;
        if (o.desc_es) f.de = o.desc_es;
        if (o.photo) f.f = o.photo;
        else if (Array.isArray(o.photos) && o.photos[0]) f.f = o.photos[0];
      }
    }
    if (f && f.n) {
      // La vista previa sale en español, que es el público principal; el nombre propio no cambia
      const nm = f.ne || f.n;
      const desc = corto(f.de || f.d || '', 190) || 'Miami Magic · Miami y los Cayos';
      const img = abs(f.f) || SITE + '/og-share.jpg';
      const url = SITE + '/?item=' + encodeURIComponent(id) + (type ? '&type=' + encodeURIComponent(type) : '');
      html = html.replace(/<title>[^<]*<\/title>/i, '<title>' + esc(nm + ' · Miami Magic') + '</title>');
      html = setMeta(html, 'name', 'description', desc);
      html = setMeta(html, 'property', 'og:title', nm + ' · Miami Magic');
      html = setMeta(html, 'property', 'og:description', desc);
      html = setMeta(html, 'property', 'og:image', img);
      html = html.replace(/<meta property="og:image:width"[^>]*>\s*/i, '').replace(/<meta property="og:image:height"[^>]*>\s*/i, '');
      html = setMeta(html, 'property', 'og:url', url);
      html = setMeta(html, 'property', 'og:type', 'website');
      html = setMeta(html, 'name', 'twitter:card', 'summary_large_image');
      html = setMeta(html, 'name', 'twitter:title', nm + ' · Miami Magic');
      html = setMeta(html, 'name', 'twitter:description', desc);
      html = setMeta(html, 'name', 'twitter:image', img);
      html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/i, '<link rel="canonical" href="' + esc(url) + '">');
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
