// Fake competitor stores + a bot-check page for price-tracking and pause-on-bot-check tests.
// Prices and stock are controllable at runtime through /__set, so a run can see them change.
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 8770);
// store key -> price, stock, currency, and how the page names the product
const SAME = { title: 'ANUA Heartleaf Pore Control Cleanser 150ml', sku: 'ANUA-HC-150', gtin: '8809640730191' };
const stores = {
  a: { price: 15.0, stock: 120, cur: 'USD', ...SAME },
  b: { price: 9.5, stock: 0, cur: 'USD', ...SAME }, // starts below a MAP of 12, and out of stock
  c: { price: 9500, stock: 40, cur: 'KRW', ...SAME }, // same product, priced only in won: never compared with a USD MAP
  d: { price: 8.0, stock: 10, cur: 'USD', title: 'ANUA Heartleaf Pore Control Cleanser 300ml', sku: '', gtin: '' }, // bigger size, no ids
};
let botOn = false; // when true, product pages return a bot check

const symbol = { USD: '$', KRW: '₩' };
const fmt = (s) => (s.cur === 'KRW' ? s.price.toLocaleString('en-US') : s.price.toFixed(2));
const productPage = (store, s) => `<!doctype html><html><head><title>${s.title}</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: s.title,
  brand: 'ANUA',
  ...(s.sku ? { sku: s.sku } : {}),
  ...(s.gtin ? { gtin13: s.gtin } : {}),
  offers: { '@type': 'Offer', price: s.cur === 'KRW' ? String(s.price) : s.price.toFixed(2), priceCurrency: s.cur, availability: s.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
})}</script></head>
<body><main><h1>${s.title}</h1>
<div class="price">${symbol[s.cur]}${fmt(s)}</div>
${s.sku ? `<p>SKU: ${s.sku}</p>` : ''}
<p>Stock : ${s.stock}</p>
<p>${s.stock > 0 ? 'In stock' : 'Out of stock'}</p>
<p>Store ${store.toUpperCase()}</p></main></body></html>`;

const botPage = () => `<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge-form"><h1>Verify you are human</h1><p>Please complete the security check to access the site.</p></div></body></html>`;

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/__set') {
      for (const k of Object.keys(stores)) {
        if (url.searchParams.has(`${k}_price`)) stores[k].price = Number(url.searchParams.get(`${k}_price`));
        if (url.searchParams.has(`${k}_stock`)) stores[k].stock = Number(url.searchParams.get(`${k}_stock`));
      }
      if (url.searchParams.has('bot')) botOn = url.searchParams.get('bot') === '1';
      res.end(JSON.stringify({ stores, botOn }));
      return;
    }
    const m = url.pathname.match(/^\/store-([a-d])\/product$/);
    if (m) {
      if (botOn) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(botPage());
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(productPage(m[1], stores[m[1]]));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  })
  .listen(PORT, () => console.log('price fixture on', PORT));
