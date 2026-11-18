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
      // Titular largo: va solo, sin " · Miami Magic News", para no alargar el título que ven los buscadores
      html = html.replace(/<title>[^<]*<\/title>/i, '<title>' + esc(title) + (title.length > 50 ? '' : ' · Miami Magic News') + '</title>');
      html = html.replace('<img src="/miami-magic-icon-192.png" alt="">', '<img src="/miami-magic-icon-192.png" alt="Miami Magic News">');
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

      // Para Google: foto grande permitida, dirección oficial de la nota y su versión en el otro idioma
      html = setMeta(html, 'name', 'robots', 'index, follow, max-image-preview:large, max-snippet:-1');
      const urlEs = SITE + '/noticias/' + id, urlEn = SITE + '/news/' + id;
      html = html.replace(/<link rel="(canonical|alternate)"[^>]*>\s*/gi, '');
      html = html.replace('</head>',
        '<link rel="canonical" href="' + esc(url) + '">\n' +
        '<link rel="alternate" hreflang="es" href="' + esc(urlEs) + '">\n' +
        '<link rel="alternate" hreflang="en" href="' + esc(urlEn) + '">\n' +
        '<link rel="alternate" hreflang="x-default" href="' + esc(urlEs) + '">\n</head>');

      // Ficha de noticia (datos estructurados NewsArticle), invisible para el lector
      const ficha = {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        headline: title.length > 110 ? title.slice(0, 107).replace(/\s+\S*$/, '') + '…' : title,
        description: desc,
        image: [img],
        datePublished: n.publicada || n.fecha,
        dateModified: n.actualizada || n.publicada || n.fecha,
        inLanguage: en ? 'en-US' : 'es-US',
        author: { '@type': 'Person', name: n.autor || 'Yolaxys Alvarez', url: SITE + (en ? '/news/about' : '/noticias/sobre') },
        publisher: {
          '@type': 'NewsMediaOrganization',
          name: 'Miami Magic News',
          url: SITE + '/noticias',
          logo: { '@type': 'ImageObject', url: SITE + '/miami-magic-icon-512.png', width: 512, height: 512 },
          publishingPrinciples: SITE + (en ? '/news/about' : '/noticias/sobre'),
          correctionsPolicy: SITE + (en ? '/news/about' : '/noticias/sobre'),
          ethicsPolicy: SITE + (en ? '/news/about' : '/noticias/sobre')
        }
      };
      // La nota completa ya dentro de la página (para Google, Bing y lectores de noticias).
      // Al cargar, el JavaScript de siempre la redibuja con el diseño normal.
      const lk = s => {
        const K = [];
        s = String(s || '').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => { K.push([t, u]); return '\u0001' + (K.length - 1) + '\u0001'; });
        return esc(s).replace(/\u0001(\d+)\u0001/g, (m, i) => '<a href="' + esc(K[i][1]) + '" rel="noopener">' + esc(K[i][0]) + '</a>');
      };
      const cuerpo = (L.cuerpo || []).filter(p => typeof p === 'string' && p.slice(0, 2) !== '::')
        .map(p => p.slice(0, 3) === '## ' ? '<h2>' + esc(p.slice(3)) + '</h2>' : p.slice(0, 2) === '- ' ? '<p>• ' + lk(p.slice(2)) + '</p>' : '<p>' + lk(p) + '</p>').join('\n');
      const toca = (L.toca || []).length ? '<ul>' + L.toca.map(t => '<li>' + lk(t) + '</li>').join('') + '</ul>' : '';
      const fuentes = (n.fuentes || []).length ? '<h2>' + (en ? 'Sources' : 'Fuentes') + '</h2><ul>' +
        n.fuentes.map(f => '<li>' + (f.u ? '<a href="' + esc(f.u) + '" rel="noopener">' + esc(f.n) + '</a>' : esc(f.n)) + '</li>').join('') + '</ul>' : '';
      const art = '<article class="col">' +
        '<h1>' + esc(title) + '</h1>' + (L.bajada ? '<p class="bajada">' + esc(L.bajada) + '</p>' : '') +
        '<p>' + (en ? 'By ' : 'Por ') + esc(n.autor || 'Yolaxys Alvarez') + ' · <time datetime="' + esc(n.publicada || n.fecha) + '">' + esc(n.fecha) + '</time></p>' +
        '<figure><img src="' + esc(img) + '" alt="' + esc(n.foto_alt || '') + '" style="max-width:100%;height:auto"></figure>' +
        toca + cuerpo + fuentes + '</article>';
      html = html.replace(/<main class="wrap" id="main"><\/main>/, '<main class="wrap" id="main">' + art + '</main>');

      html = html.replace('</head>', '<script type="application/ld+json">' +
        JSON.stringify(ficha).replace(/</g, '\\u003c') + '</script>\n</head>');
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
