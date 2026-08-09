#!/usr/bin/env node
// ============================================================
// build-seo.js
// Makes the site's content visible to search engines.
//
// Everything on this site is rendered by JavaScript, so a crawler that
// does not execute JS sees an empty price table. This script:
//   1. Pre-renders the provincial price table into index.html
//   2. Generates /fr/index.html as a real, indexable French page
//   3. Refreshes sitemap.xml
//
// app.js overwrites the pre-rendered rows on load, so users get the
// sortable, translated table exactly as before. This is progressive
// enhancement: same experience for people, real content for crawlers.
//
// Idempotent — safe to re-run after every data update.
// Run: node scripts/build-seo.js
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SITE_URL = 'https://ev-recharge.ca';

// --- Extract a top-level `const NAME = {...};` object from a JS source file ---
function extractObject(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const start = src.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`${name} introuvable dans ${file}`);

  // Walk braces to find the matching close, ignoring braces inside strings
  const from = src.indexOf('{', start);
  let depth = 0, quote = null, end = -1;
  for (let i = from; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(`Accolade fermante introuvable pour ${name}`);

  return vm.runInNewContext('(' + src.slice(from, end) + ')');
}

const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// --- Build table rows matching buildTable() in js/app.js ---
function buildTableRows(evData, translations, lang) {
  const t = key => translations[lang][key] ?? translations.en[key] ?? key;
  const provinceName = code =>
    (translations[lang].provinces && translations[lang].provinces[code]) || code;

  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  const modelKeys = {
    fixed: 'modelFixed', time: 'modelTime', power: 'modelPower',
    mixed: 'modelMixed', 'n/a': 'modelNA'
  };

  const prices = evData.provinces.filter(p => p.dcFast !== null).map(p => p.dcFast);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // Default sort in app.js: dcFast, descending
  const sorted = [...evData.provinces].sort((a, b) => {
    if (a.dcFast === null) return 1;
    if (b.dcFast === null) return -1;
    return b.dcFast - a.dcFast;
  });

  const fmtPrice = val => {
    if (val === null) return `<span class="price-cell na">${escapeHtml(t('popupNA'))}</span>`;
    let cls = 'price-cell';
    if (val <= minPrice + 0.05) cls += ' highlight-low';
    else if (val >= maxPrice - 0.05) cls += ' highlight-high';
    return `<span class="${cls}">${val.toFixed(3)}</span>`;
  };

  return sorted.map(p => {
    const modelClass = `model-${p.pricingModel === 'n/a' ? 'na' : p.pricingModel}`;
    const modelLabel = escapeHtml(t(modelKeys[p.pricingModel] || 'modelNA'));
    return `
      <tr>
        <td><strong>${escapeHtml(provinceName(p.code))}</strong></td>
        <td>${fmtPrice(p.level1)}</td>
        <td>${fmtPrice(p.level2)}</td>
        <td>${fmtPrice(p.dcFast)}</td>
        <td>${p.totalPorts.toLocaleString(locale)}</td>
        <td>${p.stations.toLocaleString(locale)}</td>
        <td><span class="model-badge ${modelClass}">${modelLabel}</span></td>
      </tr>`;
  }).join('');
}

// --- Replace content between HTML markers ---
function injectBetween(html, marker, content) {
  const open = `<!-- BEGIN:${marker} -->`;
  const close = `<!-- END:${marker} -->`;
  const a = html.indexOf(open);
  const b = html.indexOf(close);
  if (a === -1 || b === -1) throw new Error(`Marqueurs ${marker} introuvables`);
  return html.slice(0, a + open.length) + content + html.slice(b);
}

// --- Translate every [data-i18n] element in the markup ---
function translateMarkup(html, translations, lang) {
  const dict = translations[lang];
  const lookup = key => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);
  let translated = 0;

  // <tag ... data-i18n="key" ...>inner</tag>
  // Inner content is matched lazily rather than with [^<]*, because several
  // elements legitimately contain markup (<br>, <strong>). No element carrying
  // data-i18n nests another element of the same tag name, so this is safe.
  html = html.replace(
    /<(\w+)([^>]*\bdata-i18n="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g,
    (match, tag, attrs, key, inner) => {
      const value = lookup(key);
      if (value === undefined || typeof value !== 'string') return match;
      translated++;
      if (/\bdata-i18n-html\b/.test(attrs)) {
        return `<${tag}${attrs}>${value.replace(/\n/g, '<br>')}</${tag}>`;
      }
      return `<${tag}${attrs}>${escapeHtml(value)}</${tag}>`;
    }
  );

  // placeholder="..." driven by data-i18n-placeholder
  html = html.replace(
    /<(\w+)([^>]*\bdata-i18n-placeholder="([^"]+)"[^>]*)>/g,
    (match, tag, attrs, key) => {
      const value = lookup(key);
      if (typeof value !== 'string') return match;
      translated++;
      return `<${tag}${attrs.replace(/placeholder="[^"]*"/, `placeholder="${escapeHtml(value)}"`)}>`;
    }
  );

  return { html, translated };
}

// --- Point the structured data at the French URL and describe it in French ---
function localizeJsonLd(html) {
  return html.replace(
    /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/,
    (match, open, json, close) => {
      let data;
      try { data = JSON.parse(json); }
      catch (e) { console.warn('JSON-LD illisible, laisse tel quel :', e.message); return match; }

      const frUrl = `${SITE_URL}/fr/`;
      for (const node of data['@graph'] || []) {
        node.url = frUrl;
        if (node['@id']) node['@id'] = node['@id'].replace(`${SITE_URL}/#`, `${frUrl}#`);

        if (node['@type'] === 'WebSite') {
          node.name = 'Prix Recharge VE Canada';
          node.description = 'Carte interactive gratuite des prix de recharge pour véhicules électriques au Canada.';
          node.inLanguage = 'fr-CA';
          if (node.about) node.about.name = 'Bornes de recharge pour véhicules électriques au Canada';
        }

        if (node['@type'] === 'WebApplication') {
          node.name = 'Carte des prix de recharge VE — Canada';
          node.description = 'Carte interactive gratuite des prix de recharge publique au Canada, avec des tarifs vérifiés par la communauté pour la recharge Niveau 2 et DC rapide, par province, réseau et borne.';
          node.browserRequirements = 'JavaScript requis';
          node.featureList = [
            'Carte interactive des bornes de recharge au Canada',
            'Prix Niveau 2 et DC rapide par province',
            'Recherche par borne, ville ou réseau',
            'Prix vérifiés par la communauté'
          ];
        }
      }
      return open + '\n  ' + JSON.stringify(data, null, 2).replace(/\n/g, '\n  ') + '\n  ' + close;
    }
  );
}

// --- Turn root-relative asset references into absolute paths (for /fr/) ---
function absolutizeAssets(html) {
  return html
    .replace(/href="css\//g, 'href="/css/')
    .replace(/src="js\//g, 'src="/js/')
    .replace(/href="favicon/g, 'href="/favicon')
    .replace(/href="privacy\.html"/g, 'href="/privacy.html"');
}

function main() {
  const evData = extractObject('js/app.js', 'evData');
  const translations = extractObject('js/i18n.js', 'translations');
  console.log(`Donnees : ${evData.provinces.length} provinces, maj ${evData.lastUpdated}`);

  const indexPath = path.join(ROOT, 'index.html');
  let en = fs.readFileSync(indexPath, 'utf8');

  // --- 1a. Re-sync the English fallback text from i18n.js ---
  // The markup inside [data-i18n] elements is what crawlers read, so it must not
  // drift from the translations. It already had: an "About" section still saying
  // DC Fast is "400V+" months after i18n.js was corrected to 50-350 kW.
  const synced = translateMarkup(en, translations, 'en');
  en = synced.html;
  console.log(`index.html : ${synced.translated} textes resynchronises depuis i18n.js`);

  // --- 1b. Pre-render the English table ---
  en = injectBetween(en, 'seo-table', buildTableRows(evData, translations, 'en'));
  fs.writeFileSync(indexPath, en, 'utf8');
  console.log('index.html : tableau pre-rendu (13 provinces)');

  // --- 2. Build the French page ---
  let fr = en;
  fr = injectBetween(fr, 'seo-table', buildTableRows(evData, translations, 'fr'));

  const result = translateMarkup(fr, translations, 'fr');
  fr = result.html;

  fr = fr
    .replace('<html lang="en"', '<html lang="fr"')
    .replace(
      /<title>.*?<\/title>/,
      '<title>Prix de recharge VE au Canada — Carte interactive gratuite</title>'
    )
    .replace(
      /(<meta name="description" content=")[^"]*(")/,
      '$1Carte interactive gratuite des prix de recharge pour véhicules électriques au Canada. Comparez les tarifs Niveau 2 et DC rapide par province, réseau et borne.$2'
    )
    .replace(
      /(<meta property="og:title" content=")[^"]*(")/,
      '$1Prix de recharge VE au Canada — Carte interactive gratuite$2'
    )
    .replace(
      /(<meta property="og:description" content=")[^"]*(")/,
      '$1Carte interactive gratuite des prix de recharge VE au Canada. Tarifs vérifiés par la communauté, par province et réseau.$2'
    )
    .replace('<meta property="og:locale" content="en_CA">', '<meta property="og:locale" content="fr_CA">')
    .replace('<meta property="og:locale:alternate" content="fr_CA">', '<meta property="og:locale:alternate" content="en_CA">')
    .replace(`<meta property="og:url" content="${SITE_URL}/">`, `<meta property="og:url" content="${SITE_URL}/fr/">`)
    .replace(`<link rel="canonical" href="${SITE_URL}/">`, `<link rel="canonical" href="${SITE_URL}/fr/">`);

  fr = localizeJsonLd(fr);
  fr = absolutizeAssets(fr);

  // Tell the app which language to open in, before i18n.js runs
  fr = fr.replace(
    '<script src="/js/i18n.js"></script>',
    '<script>window.__forceLang = "fr";</script>\n  <script src="/js/i18n.js"></script>'
  );

  const frDir = path.join(ROOT, 'fr');
  fs.mkdirSync(frDir, { recursive: true });
  fs.writeFileSync(path.join(frDir, 'index.html'), fr, 'utf8');
  console.log(`fr/index.html : ${result.translated} elements traduits`);

  // --- 3. Sitemap ---
  const today = new Date().toISOString().split('T')[0];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${SITE_URL}/</loc>
    <xhtml:link rel="alternate" hreflang="en-CA" href="${SITE_URL}/"/>
    <xhtml:link rel="alternate" hreflang="fr-CA" href="${SITE_URL}/fr/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/"/>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/fr/</loc>
    <xhtml:link rel="alternate" hreflang="en-CA" href="${SITE_URL}/"/>
    <xhtml:link rel="alternate" hreflang="fr-CA" href="${SITE_URL}/fr/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/"/>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${SITE_URL}/privacy.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>
`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap, 'utf8');
  console.log('sitemap.xml : 3 URL');

  console.log('\nTermine. git add index.html fr/ sitemap.xml && commit && push');
}

main();
