// "Lo que mueve hoy" (debajo de "Lo último" en cada nota de News), sin trabajo a mano:
//  · videos: los más nuevos del canal de YouTube de Miami Magic (RSS público del canal)
//  · app: los lugares con "added" (fecha en que entraron a la app) en cayos.json y sitios.json
//  · sugerencias.json: lo que se quiera fijar a mano y traducciones de títulos de video (t_es por id)
const CANAL = 'UCStM8mY9d6kRSTFPMtRAvqQ';

function dec(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
async function getJson(url) {
  try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function videos(over) {
  try {
    const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + CANAL);
    if (!r.ok) return [];
    const x = await r.text();
    return x.split('<entry>').slice(1).map(function (e) {
      const id = (e.match(/<yt:videoId>([^<]+)</) || [])[1];
      const t = dec((e.match(/<title>([^<]*)</) || [])[1]).replace(/\s*\|\s*Miami Magic\.?$/i, '').trim();
      const p = (e.match(/<published>([^<]+)</) || [])[1] || '';
      if (!id || !t) return null;
      const o = over[id] || {};
      const en = o.t_en || t.split(' | ')[0].trim();
      const es = o.t_es || (t.indexOf(' | ') > 0 ? t.split(' | ').slice(1).join(' | ').trim() : en);
      return {
        tipo: 'video', u: 'https://youtu.be/' + id, d: p.slice(0, 10),
        foto: o.foto || 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
        eb_es: 'YOUTUBE · MIAMI MAGIC', eb_en: 'YOUTUBE · MIAMI MAGIC', t_es: es, t_en: en
      };
    }).filter(Boolean).slice(0, 4);
  } catch (e) { return []; }
}
function lugares(cay, sit) {
  const out = [];
  const hoy = Date.now();
  const add = function (it, ky) {
    if (!it || !it.added || !it.name || !it.id) return;
    const t = Date.parse(it.added);
    if (!t || hoy - t > 45 * 864e5) return;
    const f = it.photo || (it.photos && it.photos[0]) || '';
    out.push({
      tipo: 'app', u: '/?item=' + encodeURIComponent(it.id), d: it.added, foto: f,
      eb_es: 'NUEVO EN LA APP' + (ky ? ' · LOS CAYOS' : ' · MIAMI'), eb_en: 'NEW IN THE APP' + (ky ? ' · THE KEYS' : ' · MIAMI'),
      t_es: it.name + ((it.type_es || it.cat_es) ? ': ' + (function (x) { return x.charAt(0).toLowerCase() + x.slice(1); })(it.type_es || it.cat_es) : ''),
      t_en: it.name + ((it.type_en || it.cat) ? ': ' + (it.type_en || it.cat) : '')
    });
  };
  (function walk(o, ky) {
    if (Array.isArray(o)) o.forEach(function (v) { walk(v, ky); });
    else if (o && typeof o === 'object') { if (o.added) add(o, ky); Object.keys(o).forEach(function (k) { if (k !== 'added' && typeof o[k] === 'object') walk(o[k], ky); }); }
  })(cay, true);
  if (sit) Object.keys(sit).forEach(function (sec) {
    const s = sit[sec];
    if (sec.charAt(0) === '_' || !s || typeof s !== 'object' || Array.isArray(s)) return;
    Object.keys(s).forEach(function (id) { const it = s[id]; if (it && typeof it === 'object') add(Object.assign({ id: id }, it), false); });
  });
  return out.sort(function (a, b) { return String(b.d).localeCompare(String(a.d)); }).slice(0, 4);
}

export default async function handler(req, res) {
  const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.miamimagicapp.com');
  const [man, cay, sit] = await Promise.all([getJson(base + '/sugerencias.json'), getJson(base + '/cayos.json'), getJson(base + '/sitios.json')]);
  const over = (man && man.videos) || {};
  const fij = ((man && man.items) || []).filter(function (x) { return x && x.u; });
  const v = await videos(over);
  const items = fij.filter(function (x) { return x.tipo === 'app'; }).concat(lugares(cay, sit))
    .concat(fij.filter(function (x) { return x.tipo === 'video'; })).concat(v);
  const seen = {};
  const out = items.filter(function (x) { if (seen[x.u]) return false; seen[x.u] = 1; return true; });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  res.status(200).send(JSON.stringify({ items: out }));
}
