// Sirve la portada de News marcada en el idioma correcto para Google:
//   /noticias → español, /news → inglés. El diseño y el JavaScript no cambian.
const SITE = 'https://www.miamimagicapp.com';

function setTag(html, re, tag) {
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', tag + '\n</head>');
}

export default async function handler(req, res) {
  const en = (req.query || {}).lang === 'en';
  const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.miamimagicapp.com');
  try {
    const r = await fetch(base + '/noticias.html');
    if (!r.ok) throw new Error('html ' + r.status);
    let html = await r.text();
    const url = SITE + (en ? '/news' : '/noticias');
    html = html.replace(/<link rel="(canonical|alternate)"[^>]*>\s*/gi, '');
    html = html.replace('</head>',
      '<link rel="canonical" href="' + url + '">\n' +
      '<link rel="alternate" hreflang="es" href="' + SITE + '/noticias">\n' +
      '<link rel="alternate" hreflang="en" href="' + SITE + '/news">\n' +
      '<link rel="alternate" hreflang="x-default" href="' + SITE + '/noticias">\n' +
      '<link rel="alternate" type="application/rss+xml" title="Miami Magic News" href="' + SITE + (en ? '/feed-en.xml' : '/feed.xml') + '">\n</head>');
    html = setTag(html, /<meta name="robots"[^>]*>/i, '<meta name="robots" content="index, follow, max-image-preview:large">');
    html = setTag(html, /<meta property="og:url"[^>]*>/i, '<meta property="og:url" content="' + url + '">');
    if (en) {
      html = html.replace('<html lang="es">', '<html lang="en">');
      html = html.replace(/<title>[^<]*<\/title>/i, '<title>Miami Magic News · What moves Miami and the Keys</title>');
      html = setTag(html, /<meta name="description"[^>]*>/i, '<meta name="description" content="Miami and Florida Keys news told by how it touches you: your home, your wallet, your street, your neighborhood and your city. In English and Spanish.">');
      html = setTag(html, /<meta property="og:title"[^>]*>/i, '<meta property="og:title" content="Miami Magic News · What moves Miami and the Keys">');
      html = setTag(html, /<meta property="og:description"[^>]*>/i, '<meta property="og:description" content="Miami and Florida Keys news, told by how it touches you.">');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    res.status(200).send(html);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(302, { Location: '/noticias.html' + (en ? '?lang=en' : '') });
    res.end();
  }
}
