// Mapas del sitio para Google, armados solos desde noticias.json.
//   /sitemap-noticias.xml → sitemap de Google News (notas de los últimos 2 días, ES y EN)
//   /sitemap-notas.xml    → todas las notas publicadas, con su fecha de cambio
//   /feed.xml y /feed-en.xml → RSS con las últimas 30 notas (español / inglés)
// Nunca incluye notas programadas para una fecha futura.
const SITE = 'https://www.miamimagicapp.com';

function x(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function hoyNY(offsetDias) {
  const d = new Date(Date.now() - (offsetDias || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export default async function handler(req, res) {
  const t = (req.query && req.query.t) || '';
  const tipo = t === 'news' ? 'news' : (t === 'rss' ? 'rss' : 'notas');
  const rssEn = (req.query && req.query.lang) === 'en';
  const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.miamimagicapp.com');
  let notas = [];
  try {
    const r = await fetch(base + '/noticias.json');
    if (r.ok) notas = ((await r.json()).notas || []);
  } catch (e) { /* mapa vacío antes que un error */ }

  const hoy = hoyNY(0);
  const desde = hoyNY(2);
  notas = notas.filter(n => n && n.id && n.fecha && n.fecha <= hoy);
  const ahora = Date.now();
  notas = notas.filter(n => !n.publicada || isNaN(Date.parse(n.publicada)) || Date.parse(n.publicada) <= ahora);
  if (tipo === 'news') notas = notas.filter(n => n.fecha >= desde);
  notas.sort((a, b) => (b.actualizada || b.fecha).localeCompare(a.actualizada || a.fecha));

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  if (tipo === 'rss') {
    const lang = rssEn ? 'en' : 'es';
    const home = SITE + (rssEn ? '/news' : '/noticias');
    const pub = n => (n.publicada || n.fecha);
    const lista = notas.slice().sort((a, b) => pub(b).localeCompare(pub(a))).filter(n => n[lang] && n[lang].titulo).slice(0, 30);
    const rfc = s => { const d = new Date(s.length === 10 ? s + 'T00:00:00-05:00' : s); return isNaN(d) ? '' : d.toUTCString(); };
    const foto = f => !f ? '' : (/^https?:/.test(f) ? f : SITE + '/fotos/' + f.replace(/^\/?(fotos\/)?/, ''));
    out.push('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">');
    out.push('<channel>');
    out.push('  <title>Miami Magic News</title>');
    out.push('  <link>' + home + '</link>');
    out.push('  <atom:link href="' + SITE + (rssEn ? '/feed-en.xml' : '/feed.xml') + '" rel="self" type="application/rss+xml"/>');
    out.push('  <description>' + (rssEn ? 'What moves Miami and the Keys' : 'Lo que mueve a Miami y los Cayos') + '</description>');
    out.push('  <language>' + (rssEn ? 'en-us' : 'es-us') + '</language>');
    out.push('  <image><url>' + SITE + '/miami-magic-icon-512.png</url><title>Miami Magic News</title><link>' + home + '</link></image>');
    for (const n of lista) {
      const L = n[lang], url = SITE + (rssEn ? '/news/' : '/noticias/') + n.id, f = foto((rssEn && n.foto_en) || n.foto);
      out.push('  <item>');
      out.push('    <title>' + x(L.titulo) + '</title>');
      out.push('    <link>' + x(url) + '</link>');
      out.push('    <guid isPermaLink="true">' + x(url) + '</guid>');
      out.push('    <pubDate>' + rfc(pub(n)) + '</pubDate>');
      out.push('    <dc:creator>' + x(n.autor || 'Yolaxys Alvarez') + '</dc:creator>');
      if (L.bajada) out.push('    <description>' + x(L.bajada) + '</description>');
      if (f) out.push('    <media:content url="' + x(f) + '" medium="image"/>');
      out.push('  </item>');
    }
    out.push('</channel>');
    out.push('</rss>');
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    return res.status(200).send(out.join('\n'));
  }
  if (tipo === 'news') {
    out.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">');
    for (const n of notas) {
      for (const lang of ['es', 'en']) {
        const L = n[lang];
        if (!L || !L.titulo) continue;
        out.push('  <url>');
        out.push('    <loc>' + x(SITE + (lang === 'en' ? '/news/' : '/noticias/') + n.id) + '</loc>');
        out.push('    <news:news>');
        out.push('      <news:publication><news:name>Miami Magic News</news:name><news:language>' + lang + '</news:language></news:publication>');
        out.push('      <news:publication_date>' + x(n.publicada || n.fecha) + '</news:publication_date>');
        out.push('      <news:title>' + x(L.titulo) + '</news:title>');
        out.push('    </news:news>');
        out.push('  </url>');
      }
    }
  } else {
    out.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">');
    for (const n of notas) {
      const es = SITE + '/noticias/' + n.id, en = SITE + '/news/' + n.id;
      const mod = n.actualizada || n.publicada || n.fecha;
      for (const loc of [es, en]) {
        out.push('  <url>');
        out.push('    <loc>' + x(loc) + '</loc>');
        out.push('    <lastmod>' + x(mod) + '</lastmod>');
        out.push('    <xhtml:link rel="alternate" hreflang="es" href="' + x(es) + '"/>');
        out.push('    <xhtml:link rel="alternate" hreflang="en" href="' + x(en) + '"/>');
        out.push('  </url>');
      }
    }
  }
  out.push('</urlset>');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  res.status(200).send(out.join('\n'));
}
