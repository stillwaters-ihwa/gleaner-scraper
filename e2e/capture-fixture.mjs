// Test pages for Page capture: a long landing page whose pictures and last sections load only as
// you scroll, an app that scrolls an inner panel instead of the page, and an article.
import http from 'node:http';

const port = Number(process.argv[2] ?? 8780);
const svg = (w, h, color, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;

const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Brightloom: plan your week</title>
<meta name="description" content="Weekly planning for small teams.">
<style>
  :root { --brand: #2f6feb; --ink: #141922; }
  body { margin: 0; font-family: Georgia, serif; color: var(--ink); background: #fbfbf9; }
  header { display: flex; justify-content: space-between; padding: 16px 32px; border-bottom: 1px solid #ddd; }
  nav a { margin-right: 16px; color: #333; text-decoration: none; }
  .btn { display: inline-block; background: var(--brand); color: #fff; padding: 12px 22px; border-radius: 10px; font-weight: 700; text-decoration: none; font-family: Arial, sans-serif; }
  .ghost { display: inline-block; border: 2px solid var(--brand); color: var(--brand); padding: 10px 20px; border-radius: 10px; text-decoration: none; }
  section { padding: 64px 32px; max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 52px; line-height: 1.1; margin: 0 0 16px; }
  h2 { font-size: 32px; margin: 0 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .card { background: #fff; border-radius: 14px; padding: 24px; box-shadow: 0 4px 14px rgba(0,0,0,.08); }
  .tall { height: 700px; }
  .secret { font-family: monospace; font-size: 20px; background: #fff3c4; padding: 6px 10px; display: inline-block; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
</style></head><body>
<header><strong>Brightloom</strong><nav><a href="/features">Features</a><a href="/pricing">Pricing</a><a class="btn" href="/signup">Start free</a></nav></header>
<main>
  <section class="hero"><h1>Plan your week in ten minutes</h1><p>Brightloom turns scattered tasks into one calm plan.</p><a class="btn" href="/signup">Start free</a> <a class="ghost" href="/demo">Watch the demo</a>
    <p><img src="/img/hero.svg" alt="Planner screenshot" width="900" height="420"></p></section>
  <section id="features"><h2>Features</h2><div class="grid">
    <div class="card"><h3>Weekly view</h3><p>Every task on one page.</p><img data-src="/img/f1.svg" alt="Weekly view" width="280" height="160" class="lazy"></div>
    <div class="card" id="pick-me"><h3>Focus timer</h3><p>Work in calm blocks.</p><a class="btn" href="/timer">Try the timer</a></div>
    <div class="card"><h3>Shared lists</h3><p>Plan with your team.</p><img data-src="/img/f3.svg" alt="Shared lists" width="280" height="160" class="lazy"></div>
  </div></section>
  <section class="tall"><h2>Contact for invoices</h2><p>Send invoices to <span class="secret" id="secret">ana.kowalska@brightloom.test</span> by Friday.</p>
    <p id="quote-me">Teams that plan on Monday finish thirty percent more of what they promised, according to our own survey of four hundred customers.</p></section>
  <section class="pricing"><h2>Pricing</h2><div class="grid"><div class="card"><h3>Solo</h3><p>Free</p></div><div class="card"><h3>Team</h3><p>$8 a seat</p><a class="btn" href="/signup?plan=team">Choose Team</a></div><div class="card"><h3>Company</h3><p>Talk to us</p></div></div></section>
  <div id="more"></div>
</main>
<footer style="padding:32px;border-top:1px solid #ddd"><a href="https://social.test/brightloom">Social</a> · 日本語のページ</footer>
<script>
  // Pictures load only when scrolled near, and two more sections appear at the end of the page
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && e.target.dataset.src) { e.target.src = e.target.dataset.src; delete e.target.dataset.src; } }), { rootMargin: '200px' });
  document.querySelectorAll('img.lazy').forEach((i) => io.observe(i));
  let added = 0;
  addEventListener('scroll', () => {
    if (added < 2 && innerHeight + scrollY > document.body.scrollHeight - 300) {
      added++;
      document.getElementById('more').insertAdjacentHTML('beforeend', '<section class="tall" style="background:#eef3ff"><h2>FAQ part ' + added + '</h2><p>Loaded as you scrolled.</p></section>');
    }
  });
</script></body></html>`;

const app = `<!doctype html><html><head><meta charset="utf-8"><title>Inbox app</title><style>html,body{height:100%;margin:0;overflow:hidden;font-family:sans-serif}
.shell{display:flex;height:100%}.side{width:200px;background:#222;color:#fff}.list{flex:1;overflow-y:auto}.row{height:120px;border-bottom:1px solid #ddd;padding:12px}</style></head>
<body><div class="shell"><div class="side">Folders</div><div class="list">${Array.from({ length: 30 }, (_, i) => `<div class="row">Message ${i + 1}</div>`).join('')}<div class="row" id="last">The last message</div></div></div></body></html>`;

const article = `<!doctype html><html><head><meta charset="utf-8"><title>How we plan a week</title><meta property="og:type" content="article"><meta name="author" content="Ines Marlow"></head><body>
<nav><a href="/">Home</a></nav><article><h1>How we plan a week</h1><p>Planning is a habit, not a tool. Every Monday we spend ten minutes writing down the three things that matter.</p>
<h2>The three questions</h2><ul><li>What must ship?</li><li>What can wait?</li><li>Who needs help?</li></ul>
<figure><img src="/img/chart.svg" alt="Chart of finished tasks" width="640" height="320"><figcaption>Finished tasks by week</figcaption></figure>
<p>We keep the plan visible all week, so nobody has to ask what is next. It is short on purpose and it is the same every week, which makes it easy to keep.</p></article><footer>© Brightloom</footer></body></html>`;

http
  .createServer((req, res) => {
    const u = new URL(req.url, `http://localhost:${port}`);
    const send = (type, body) => (res.writeHead(200, { 'content-type': type }), res.end(body));
    if (u.pathname === '/landing') return send('text/html; charset=utf-8', landing);
    if (u.pathname === '/app') return send('text/html; charset=utf-8', app);
    if (u.pathname === '/article') return send('text/html; charset=utf-8', article);
    // A tall page with a fixed red top bar, bands of colour, and more bands loaded at the bottom
    if (u.pathname === '/sticky')
      return send('text/html; charset=utf-8', `<!doctype html><html><head><meta charset="utf-8"><title>Sticky bar page</title><style>body{margin:0;font:16px sans-serif}#bar{position:fixed;top:0;left:0;right:0;height:60px;background:rgb(220,30,30);color:#fff;z-index:9}.band{height:500px;border-bottom:1px solid #999}</style></head><body><div id="bar">Brightloom top bar</div><main id="m">${Array.from({ length: 8 }, (_, i) => `<div class="band" style="background:hsl(${i * 40},40%,80%)">Band ${i + 1}</div>`).join('')}</main>
      <script>let n = 8; addEventListener('scroll', () => { if (n >= 12 || innerHeight + scrollY < document.body.scrollHeight - 200) return; n += 2; setTimeout(() => document.getElementById('m').insertAdjacentHTML('beforeend', [0, 1].map((k) => '<div class="band" style="background:hsl(' + (n + k) * 40 + ',40%,80%)">Band ' + (n - 1 + k) + '</div>').join('')), 300); });</script></body></html>`);
    const img = /^\/img\/(\w+)\.svg$/.exec(u.pathname);
    if (img) return send('image/svg+xml', svg(img[1] === 'hero' ? 900 : 640, img[1] === 'hero' ? 420 : 320, { hero: '#2f6feb', f1: '#1d7a4e', f3: '#e3b04b', chart: '#7a4ed9' }[img[1]] ?? '#888', img[1]));
    res.writeHead(404);
    res.end('not found');
  })
  .listen(port, () => console.log('capture fixture on', port));
