// Local wholesale store that behaves like the k-beauty site: POST-form pager with blocks of 10,
// logged-in style cards, product pages, and deliberate failures to test the guardrail.
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 8765);
const PAGES = 45;
const PER = 20;
const brands = ['ANUA', 'Medicube', 'Dr.Althea', 'TOCOBO', 'Beauty of Joseon', 'Skin1004'];
const product = (i) => ({
  sku: `SKU${String(10000 + i)}-A`,
  part: String(11300000 + i * 7),
  brand: brands[i % brands.length],
  name: `${['Heartleaf Pore Control Cleanser', 'PDRN Pink Collagen Gel Mask', 'Zero Pore Serum', 'Relief Cream', 'Bio Watery Sun Screen'][i % 5]} ${150 + (i % 4) * 10}ml #${i + 1}`,
  krw: 8000 + ((i * 1370) % 30000),
  stock: (i * 37) % 2000,
  moq: [5, 10, 12, 24][i % 4],
  box: [24, 48, 60, 100][i % 4],
  carton: [240, 480, 600, 1000][i % 4],
  barcode: String(8800000000000 + i * 13),
});

// Failure plan: page -> number of times it fails before working. Can be changed at runtime.
let failPlan = { 12: 1, 41: 2 };
let lastHit = 0;
let minGapMs = 350; // requests closer than this get a "too fast" error
let botFrom = 0; // when >0, pages >= this number return a bot check
const log = [];

const botPage = () => `<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge-form"><h1>Verify you are human</h1><p>Complete the security check to continue.</p></div></body></html>`;
const errorPage = (msg) => `<!doctype html><html><head><title>Error of No.500</title></head><body><div id="notfound"><h1>Oops!</h1><h2>${msg}</h2><a href="/">Go to homepage</a></div></body></html>`;

function listing(page) {
  const block = Math.ceil(page / 10);
  const start = (block - 1) * 10 + 1;
  const nums = [];
  for (let n = start; n < start + 10 && n <= PAGES; n++) {
    nums.push(n === page ? `<li class="page-item active"><a class="page-link" href="javascript: void(0)" page="${n}">${n} <span class="sr-only">(current)</span></a></li>` : `<li class="page-item"><a class="page-link" href="javascript:void(0)" page="${n}">${n}</a></li>`);
  }
  const prev = block > 1 ? `<li class="page-item"><a class="page-link" href="javascript:void(0)" page="${start - 1}">&laquo;</a></li>` : '';
  const next = start + 10 <= PAGES ? `<li class="page-item"><a class="page-link" href="javascript:void(0)" page="${start + 10}">&raquo;</a></li>` : '';
  const cards = Array.from({ length: PER }, (_, k) => {
    const i = (page - 1) * PER + k;
    const p = product(i);
    const usd = (p.krw / 1320).toFixed(2);
    return `<div class="col-sm-6 col-md-6 col-lg-4"><div class="card mb-4 shadow-sm">
      <a href="/Detail/${p.sku}" class="item_img"><img src="/img/${i}.svg?s=${[300, 800, 1500, 2400][i % 4]}" class="card-img-top Img_Product" width="200" height="200"></a>
      <div class="card-body">
        <p class="card-text"><a href="/Detail/${p.sku}">[${p.brand}] ${p.name}</a></p>
        <div class="price"><strong>&#8361;${p.krw.toLocaleString('en-US')}</strong> / <span>$${usd}</span></div>
        <p class="small">SKU: ${p.sku} PartNum : ${p.part}</p>
        <p class="small">Bar Code: ${p.barcode}</p>
        <p class="small">Stock : ${p.stock.toLocaleString('en-US')}  MOQ : ${p.moq}ea</p>
        <p class="small">1Box : ${p.box}ea  1Carton: ${p.carton}ea</p>
        <button class="btn">Add to Cart</button>
      </div></div></div>`;
  }).join('\n');
  return `<!doctype html><html><head><title>wholesale fixture</title></head><body>
  <nav><a href="/">Home</a> <a href="/Product/Best">Best</a></nav>
  <form id="frm" method="post" action="/Product/Best">
    <input type="hidden" name="block_pages" value="10"><input type="hidden" name="page_rows" value="${PER}">
    <input type="hidden" name="curr_block" value="${block}"><input type="hidden" name="curr_page" value="${page}">
  </form>
  <div class="album mt-4"><div class="container"><div class="row" id="p-list">${cards}</div></div></div>
  <ul class="pagination">${prev}${nums.join('')}${next}</ul>
  <script>
    document.querySelectorAll('.page-link').forEach(function (a) {
      a.addEventListener('click', function () {
        var f = document.getElementById('frm');
        var n = parseInt(a.getAttribute('page'), 10);
        f.curr_page.value = n; f.curr_block.value = Math.ceil(n / 10); f.submit();
      });
    });
  </script></body></html>`;
}

function detail(sku) {
  const i = parseInt(sku.slice(3), 10) - 10000;
  const p = product(i);
  return `<!doctype html><html><head><title>${p.name}</title></head><body><header><img src="/img/99999.svg?s=40" alt="logo"></header><main><div class="product">
    <div class="gallery"><img src="/img/${i}.svg?s=2400" alt="main"><img src="/img/${i + 50000}.svg?s=1200" alt="side"></div>
    <h1>[${p.brand}] ${p.name}</h1>
    <div class="price">&#8361;${p.krw.toLocaleString('en-US')} / $${(p.krw / 1320).toFixed(2)}</div>
    <table><tr><th>SKU</th><td>${p.sku}</td></tr><tr><th>Part Num</th><td>${p.part}</td></tr><tr><th>Stock</th><td>${p.stock}</td></tr>
    <tr><th>MOQ</th><td>${p.moq} ea</td></tr><tr><th>Qty per box</th><td>${p.box}</td></tr><tr><th>Qty per carton</th><td>${p.carton}</td></tr>
    <tr><th>Origin</th><td>Korea</td></tr><tr><th>Volume</th><td>${150 + (i % 4) * 10}ml</td></tr></table>
    <p class="description">A gentle daily product for all skin types. Sample description text for testing.</p></div><div class="related-products"><h2>You may also like</h2><img src="/img/${i + 1}.svg?s=300" alt="other">
  </div></main></body></html>`;
}

const svg = (n, s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 200 200"><rect width="200" height="200" fill="${['#f4c6d0', '#cfe8d5', '#d5def5', '#f5ead5'][n % 4]}"/><text x="20" y="100">${n}</text></svg>`;

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname === '/__control') {
        if (url.searchParams.has('fail')) failPlan = JSON.parse(url.searchParams.get('fail'));
        if (url.searchParams.has('gap')) minGapMs = Number(url.searchParams.get('gap'));
        if (url.searchParams.has('botFrom')) botFrom = Number(url.searchParams.get('botFrom'));
        res.end(JSON.stringify({ failPlan, minGapMs, log: log.slice(-200) }));
        return;
      }
      if (url.pathname.startsWith('/img/')) {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        res.end(svg(parseInt(url.pathname.slice(5), 10) || 0, Number(url.searchParams.get('s')) || 200));
        return;
      }
      if (url.pathname.startsWith('/Detail/')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(detail(url.pathname.slice(8)));
        return;
      }
      if (url.pathname === '/Product/Best' || url.pathname === '/') {
        const form = new URLSearchParams(body);
        const page = Math.min(PAGES, Math.max(1, parseInt(form.get('curr_page') ?? url.searchParams.get('page') ?? '1', 10)));
        const now = Date.now();
        if (botFrom && page >= botFrom) { log.push({ page, result: 'bot' }); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(botPage()); return; }
        const tooFast = req.method === 'POST' && now - lastHit < minGapMs;
        lastHit = now;
        if (tooFast || failPlan[page] > 0) {
          if (!tooFast) failPlan[page]--;
          log.push({ page, result: tooFast ? 'too-fast' : 'planned-fail' });
          res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
          res.end(errorPage('An unknown error occurred while accessing the page.'));
          return;
        }
        log.push({ page, result: 'ok' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(listing(page));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
  })
  .listen(PORT, () => console.log('fixture on', PORT));
