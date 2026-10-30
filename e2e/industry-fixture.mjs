// Test site for the industry tools: a job board (embedded app data, 3 pages, job pages with
// JobPosting), a property search (Next.js-style page data) and listing pages, hotels (schema.org
// list), a business directory with only visible cards, a news site with an RSS feed, product
// reviews across 2 pages, a company website, and a page of HTML tables.
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 8772);
const BASE = `http://127.0.0.1:${PORT}`;
import zlib from 'node:zlib';
const pad = 'x'.repeat(400);
const html = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

const JOBS = Array.from({ length: 30 }, (_, i) => ({
  jobkey: `job${i}`,
  displayTitle: ['Cosmetic Chemist', 'Brand Manager', 'Esthetician', 'Data Analyst', 'Senior Product Designer'][i % 5] + ` ${i + 1}`,
  company: ['Glow Labs', 'Seoul Beauty', 'Acme Retail'][i % 3],
  formattedLocation: ['Austin, TX', 'Remote', 'New York, NY'][i % 3],
  salarySnippet: { text: i % 2 ? '$60,000 - $80,000 a year' : '$25 - $32 an hour' },
  formattedRelativeTime: `${(i % 9) + 1} days ago`,
  jobTypes: [i % 4 ? 'Full-time' : 'Part-time'],
  remoteLocation: i % 3 === 1,
}));

function jobsPage(page) {
  const slice = JOBS.slice((page - 1) * 10, page * 10);
  const cards = slice.map((j) => `<li class="job"><h2><a href="/jobs/view/${j.jobkey}">${j.displayTitle}</a></h2><span class="company">${j.company}</span><span class="location">${j.formattedLocation}</span></li>`).join('');
  const next = page < 3 ? `<a rel="next" href="/jobs/search?page=${page + 1}">Next</a>` : '';
  return html(`Jobs page ${page}`, `<ul class="results">${cards}</ul><nav class="pager">${next}</nav><script>window.mosaic = {}; window.mosaic.providerData = {"results": ${JSON.stringify(slice.map((j) => ({ ...j, viewJobLink: `/jobs/view/${j.jobkey}` })))}, "pad": "${pad}"};</script>`);
}

function jobView(id) {
  const j = JOBS.find((x) => x.jobkey === id);
  return html(j.displayTitle, `<h1>${j.displayTitle}</h1><p>Full description for ${j.displayTitle}.</p>`, ld({ '@context': 'https://schema.org', '@type': 'JobPosting', title: j.displayTitle, hiringOrganization: { name: j.company }, jobLocation: { address: { addressLocality: j.formattedLocation } }, employmentType: 'FULL_TIME', datePosted: '2026-10-10', validThrough: '2026-12-31', description: `<p>Full description for ${j.displayTitle}. Benefits include health insurance.</p>`, baseSalary: { currency: 'USD', value: { minValue: 70000, maxValue: 90000, unitText: 'YEAR' } } }));
}

const HOMES = Array.from({ length: 16 }, (_, i) => ({
  zpid: String(5000 + i),
  price: `$${(300 + i * 25).toLocaleString()},000`,
  unformattedPrice: (300 + i * 25) * 1000,
  addressStreet: `${100 + i} Maple Ave`,
  addressCity: 'Austin',
  addressState: 'TX',
  addressZipcode: '78701',
  beds: 2 + (i % 3),
  baths: 1 + (i % 2),
  area: 1100 + i * 50,
  statusText: i % 5 === 4 ? 'Apartment for rent' : 'House for sale',
  detailUrl: `/home/${5000 + i}`,
  latLong: { latitude: 30.2 + i / 100, longitude: -97.7 },
  brokerName: 'Lone Star Realty',
}));

function homesPage(page) {
  const slice = HOMES.slice((page - 1) * 8, page * 8);
  const cards = slice.map((h) => `<article class="card"><a href="${h.detailUrl}">${h.addressStreet}</a><span>${h.price}</span></article>`).join('');
  return html(`Homes page ${page}`, `<div id="grid">${cards}</div>${page < 2 ? `<a rel="next" href="/homes?page=${page + 1}">Next page</a>` : ''}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { searchPageState: { cat1: { searchResults: { listResults: slice } } } } }, pad })}</script>`);
}

function homeView(id) {
  const h = HOMES.find((x) => x.zpid === id);
  return html(h.addressStreet, `<h1>${h.addressStreet}</h1>`, ld({ '@type': ['SingleFamilyResidence', 'Product'], name: h.addressStreet, address: { streetAddress: h.addressStreet, addressLocality: 'Austin', addressRegion: 'TX', postalCode: '78701' }, numberOfBedrooms: h.beds, numberOfBathroomsTotal: h.baths, floorSize: { value: h.area, unitCode: 'FTK' }, yearBuilt: 1990 + (Number(id) % 30), offers: { price: h.unformattedPrice, priceCurrency: 'USD' } }));
}

const hotels = html(
  'Hotels in Seoul',
  '<h1>Hotels in Seoul</h1>',
  ld({
    '@type': 'ItemList',
    itemListElement: ['Lotte Hotel Seoul', 'Signiel Seoul', 'Four Seasons Seoul', 'Josun Palace'].map((name, i) => ({
      '@type': 'ListItem',
      item: { '@type': 'Hotel', name, url: `${BASE}/hotel/${i}`, aggregateRating: { ratingValue: 4.4 + i / 10, reviewCount: 1000 + i * 250 }, starRating: { ratingValue: 5 }, priceRange: '$$$$', address: { addressLocality: 'Seoul', addressCountry: 'KR' } },
    })),
  }),
);

// Directory with only visible cards (no structured data): read through the list finder
const BIZ = ['Ace Plumbing', 'Bright Electric', 'City Locksmith', 'Delta HVAC', 'Eagle Roofing', 'Fixit Handyman'];
const directory = html(
  'Plumbers in Austin',
  `<h1>Plumbers in Austin</h1><div class="results">${BIZ.map((n, i) => `<div class="result"><h3 class="business-name"><a href="/biz/${i}">${n}</a></h3><div class="categories">Plumbing, Repair</div><div class="phones">(512) 555-01${10 + i}</div><div class="street-address">${200 + i} Main St, Austin, TX 78701</div><div class="ratings">4.${i} of 5 stars, ${20 + i} reviews</div><a href="https://${n.toLowerCase().replace(/\s/g, '')}.example.com">Website</a></div>`).join('')}</div>`,
);

const ARTICLES = [
  ['k-beauty-exports-hit-record-high-this-year', 'K-beauty exports hit a record high this year', 'Exports grew strongly with excellent demand and record success for brands.'],
  ['sunscreen-sales-surge-across-europe-summer', 'Sunscreen sales surge across Europe this summer', 'Sales surged and retailers praised the strong growth.'],
  ['factory-recall-after-contamination-scandal-hits', 'Factory recall after contamination scandal hits brand', 'A terrible recall followed the scandal and losses mounted.'],
  ['retailers-report-mixed-results-quarterly-update', 'Retailers report mixed results in quarterly update', 'Results were mixed as costs rose and demand held.'],
];
const articleUrl = (slug, i) => `/news/2026/10/${10 + i}/${slug}`;
const newsHome = html('Beauty Daily', `<nav><a href="/news/2026/10/01/old-nav-story-should-not-be-collected">Nav story should not be collected here</a></nav><main>${ARTICLES.map(([slug, title], i) => `<h2><a href="${articleUrl(slug, i)}">${title}</a></h2>`).join('')}<a href="/tag/skincare">Skincare tag page</a></main>`, `<link rel="alternate" type="application/rss+xml" href="/feed.xml">`);
const article = (i) => {
  const [slug, title, lede] = ARTICLES[i];
  return html(title, `<article><h1>${title}</h1>${`<p>${lede} Korean cosmetics makers expanded into new markets, opened stores and signed distribution deals across the region this quarter.</p>`.repeat(5)}</article>`, `<meta property="og:site_name" content="Beauty Daily"><link rel="canonical" href="${BASE}${articleUrl(slug, i)}">${ld({ '@type': 'NewsArticle', headline: title, author: { name: 'Min-ji Park' }, datePublished: `2026-10-${10 + i}T08:00:00Z`, publisher: { name: 'Beauty Daily' } })}`);
};
const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Beauty Daily</title>${ARTICLES.map(([slug, title, lede], i) => `<item><title>${title}</title><link>${BASE}${articleUrl(slug, i)}</link><pubDate>${new Date(Date.UTC(2026, 9, 10 + i, 8)).toUTCString()}</pubDate><description>${lede}</description></item>`).join('')}</channel></rss>`;

const REVIEWS = [
  [5, 'Love it', 'Gentle formula and soothing, my skin feels amazing.'],
  [5, 'Holy grail', 'Gentle formula, calming and hydrating. Excellent.'],
  [4, 'Very good', 'Gentle formula works well, a bit pricey.'],
  [2, 'Not for me', 'Strong smell and sticky texture, disappointed.'],
  [1, 'Broke me out', 'Terrible rash, strong smell, sticky texture.'],
  [5, 'Great value', 'Excellent toner, gentle formula and fast shipping.'],
];
const reviewBlock = ([stars, title, body]) => `<div data-hook="review"><span class="a-profile-name">Shopper Name</span><i data-hook="review-star-rating"><span>${stars}.0 out of 5 stars</span></i><a data-hook="review-title"><span>${stars}.0 out of 5 stars</span><span>${title}</span></a><span data-hook="review-date">Reviewed in the United States on September ${stars + 3}, 2026</span><span data-hook="avp-badge">Verified Purchase</span><span data-hook="review-body"><span>${body}</span></span></div>`;
const reviewsPage = (page) => html(`Reviews page ${page}`, `<span id="productTitle">Heartleaf Toner 250ml</span>${REVIEWS.slice((page - 1) * 3, page * 3).map(reviewBlock).join('')}<ul class="a-pagination">${page === 1 ? '<li class="a-last"><a href="/reviews?page=2">Next page</a></li>' : ''}</ul>`);

// Google-style reviews: star icons instead of text, a scrolling panel that loads 10 more as it
// scrolls (30 in all), and a "More" control that opens the rest of a long review
const GOLD = 'rgb(250,187,5)';
const GREY = 'rgb(218,220,224)';
const NAMES = ['Mina', 'Joon', 'Ava', 'Leo', 'Sora', 'Kai', 'Noa', 'Eli', 'Rin', 'Max'];
const scrollReview = (i) => {
  const stars = [5, 4, 5, 2, 5, 3, 4, 5, 1, 5][i % 10];
  const long = i % 4 === 0;
  return `<div class="bwb7ce"><div class="who"><span>${NAMES[i % 10]} ${i}</span><span class="sub">Local Guide · 12 reviews</span></div>
    <div class="h3PQJ" role="img" aria-label="">${Array.from({ length: 5 }, (_, k) => `<svg width="14" height="14" viewBox="0 0 24 24"><path fill="${k < stars ? GOLD : GREY}" d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"/></svg>`).join('')}</div>
    <span class="m6Mr5d">${(i % 11) + 1} weeks ago</span>
    <div class="d83Iyc">Visit ${i}: ${stars >= 4 ? 'Relaxing massage and friendly staff, very clean rooms.' : 'Waited too long and the room was cold, disappointing.'}${long ? `<span class="rest" hidden> The hot stone add-on was worth it and I will come back again for review ${i}.</span> <div role="button" tabindex="0" jsaction="click:expand" class="more" onclick="this.previousElementSibling.hidden=false;this.remove()">More</div>` : ''}</div>
    ${i % 5 === 0 ? `<div class="KmCjbd"><span>Response from the owner</span> Thank you for visiting us!</div>` : ''}
    <a href="/goto?url=https://example.com">Read more on Example</a></div>`;
};
const reviewsScroll = html('Mizpah Wellness Spa reviews', `<h1>Mizpah Wellness Spa</h1><p>4.4 · 30 reviews</p>
  <div class="RVCQse" id="box" style="height:420px;overflow-y:auto">${Array.from({ length: 10 }, (_, i) => scrollReview(i)).join('')}</div>
  <script>
    const box = document.getElementById('box');
    const tpl = ${JSON.stringify(Array.from({ length: 30 }, (_, i) => scrollReview(i)))};
    let shown = 10, busy = false;
    box.addEventListener('scroll', () => {
      if (busy || shown >= 30 || box.scrollTop + box.clientHeight < box.scrollHeight - 40) return;
      busy = true;
      setTimeout(() => { box.insertAdjacentHTML('beforeend', tpl.slice(shown, shown + 10).join('')); shown += 10; busy = false; }, 400);
    });
  </script>`);

// Google's review window, closely: a pop-up window over a results page that has its own "Next"
// link, a review list that loads 10 more only on a real mouse wheel near its bottom (scrolling by
// script does nothing), review ids, reviewer photos (and a profile picture that isn't one), and
// "1 review · 2 photos" lines that aren't review text. 45 reviews, 5 of them stars only.
const wheelReview = (i) => {
  const stars = [5, 4, 5, 3, 5, 1, 5, 4, 2, 5][i % 10];
  const photos = i % 3 === 0 ? [1, 2].map((n) => `<img alt="Photo ${n} in review by Guest ${i}" width="125" height="125" src="${BASE}/protected/r${i}-${n}=s125-p-k-rw">`).join('') : '';
  const text = i % 9 === 4 ? '' : `Visit ${i}: ${stars >= 4 ? 'calm rooms and a skilled masseuse, would book again.' : 'the room was cold and we waited too long.'}`;
  return `<div class="bwb7ce" data-id="rv${i}"><div class="who"><span style="display:inline-block;width:32px;height:32px;border-radius:50%;background-image:url(${BASE}/protected/avatar${i}=s64)"></span><span>Guest ${i}</span><span class="sub">1 review · ${photos ? 2 : 0} photos</span></div>
    <div class="h3PQJ" role="img">${Array.from({ length: 5 }, (_, k) => `<svg width="14" height="14" viewBox="0 0 24 24"><path fill="${k < stars ? GOLD : GREY}" d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"/></svg>`).join('')}</div>
    <span class="m6Mr5d">${(i % 11) + 1} weeks ago</span>
    ${text ? `<div class="d83Iyc">${text}</div>` : ''}
    ${photos ? `<g-scrolling-carousel><div class="strip">${photos}</div><g-right-button role="button" aria-label="Next">›</g-right-button></g-scrolling-carousel>` : ''}
    <span data-review-id="rv${i}"></span></div>`;
};
const reviewsWheel = html('mizpah wellness spa - Search', `<div style="height:2400px"><h1>Results</h1><a id="pnnext" href="/page-two">Next</a></div>
  <div role="dialog" aria-modal="true" style="position:fixed;top:40px;left:120px;width:700px;height:600px;background:#fff;border:1px solid #ccc">
    <h2 role="heading">Mizpah Wellness Spa</h2>
    <div class="RVCQse" id="box" style="height:500px;overflow-y:auto">${Array.from({ length: 10 }, (_, i) => wheelReview(i)).join('')}</div>
  </div>
  <script>
    const box = document.getElementById('box');
    const all = ${JSON.stringify(Array.from({ length: 45 }, (_, i) => wheelReview(i)))};
    let shown = 10, busy = false;
    window.__scriptScrollsIgnored = 0;
    box.addEventListener('scroll', () => { window.__scriptScrollsIgnored++; });
    box.addEventListener('wheel', (e) => {
      if (!e.isTrusted || busy || shown >= all.length || box.scrollTop + box.clientHeight < box.scrollHeight - 600) return;
      busy = true;
      setTimeout(() => { box.insertAdjacentHTML('beforeend', all.slice(shown, shown + 10).join('')); shown += 10; busy = false; }, 500);
    }, { passive: true });
  </script>`);

// Reviews behind a "Show 10 more reviews" button (25 in all)
const moreReview = (i) => `<div class="review-item"><div class="stars" aria-label="${(i % 5) + 1} out of 5 stars">${'★'.repeat((i % 5) + 1)}</div><time datetime="2026-09-${String((i % 28) + 1).padStart(2, '0')}">Sep ${(i % 28) + 1}, 2026</time><p class="review-text">Review number ${i}: ${i % 2 ? 'Smooth texture and gentle on skin.' : 'Too sticky for my taste, stings a bit.'}</p></div>`;
const reviewsMore = html('Snail essence reviews', `<h1>Snail Mucin Essence</h1><div id="list">${Array.from({ length: 10 }, (_, i) => moreReview(i)).join('')}</div>
  <button id="more" type="button">Show 10 more reviews</button>
  <script>
    const all = ${JSON.stringify(Array.from({ length: 25 }, (_, i) => moreReview(i)))};
    let shown = 10;
    document.getElementById('more').onclick = () => setTimeout(() => {
      document.getElementById('list').insertAdjacentHTML('beforeend', all.slice(shown, shown + 10).join(''));
      shown += 10;
      if (shown >= 25) document.getElementById('more').remove();
    }, 300);
  </script>`);

// A shop whose product grid grows as you scroll (72 products, 24 at a time)
const shopCard = (i) => `<div class="product-card"><a href="/p/${i}"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23${(0x335577 + i * 2049).toString(16).slice(-6)}'/%3E%3C/svg%3E" width="300" height="300" alt="Snail product ${i}"><h3 class="product-title">Snail Essence No.${i} 100ml</h3></a><span class="price">$${(12 + (i % 9)).toFixed(2)}</span></div>`;
const shopScroll = html('Snail essence | Glow Shop', `<h1>Snail essence</h1><div class="grid" id="grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">${Array.from({ length: 24 }, (_, i) => shopCard(i)).join('')}</div><div id="sentinel" style="height:40px"></div>
  <script>
    let shown = 24, busy = false;
    addEventListener('scroll', () => {
      if (busy || shown >= 72 || innerHeight + scrollY < document.body.scrollHeight - 300) return;
      busy = true;
      setTimeout(() => { document.getElementById('grid').insertAdjacentHTML('beforeend', ${JSON.stringify(Array.from({ length: 72 }, (_, i) => shopCard(i)))}.slice(shown, shown + 24).join('')); shown += 24; busy = false; }, 500);
    });
  </script>`);

const company = html(
  'Glow Labs | Korean skincare',
  `<header><a href="/contact">Contact us</a> <a href="/about">About</a></header><h1>Glow Labs</h1><p>Clean K-beauty skincare.</p><footer><a href="https://www.instagram.com/glowlabs">Instagram</a> <a href="https://www.tiktok.com/@glowlabs">TikTok</a> <a href="https://wa.me/821012345678">WhatsApp</a></footer><script src="https://cdn.shopify.com/s/files/1/theme.js"></script><script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>`,
  `<meta name="description" content="Clean Korean skincare made in Seoul.">${ld({ '@type': 'Organization', name: 'Glow Labs Inc.', foundingDate: '2015', logo: `${BASE}/logo.png`, numberOfEmployees: { value: 42 } })}`,
);
const contact = html('Contact', `<h1>Contact</h1><p>Wholesale: <a href="mailto:wholesale@glowlabs.example.com">wholesale@glowlabs.example.com</a></p><p>Call +82 2-555-0199</p>`, ld({ '@type': 'Organization', name: 'Glow Labs Inc.', address: { streetAddress: '12 Gangnam-daero', addressLocality: 'Seoul', addressCountry: 'KR' } }));

const tables = html('Price table', `<table><thead><tr><th>Product</th><th>Size</th><th>Price</th></tr></thead><tbody><tr><td>Toner</td><td>250ml</td><td>$18</td></tr><tr><td>Serum</td><td>50ml</td><td>$24</td></tr></tbody></table><table><tr><td>Layout</td></tr></table>`);

function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PROTECTED = png(1200, 800, [240, 200, 210]);
const gallery = html('Shop gallery', '<h1>Heartleaf Toner</h1><div class="detail"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" ec-data-src="/protected/toner-detail.png" alt="detail"></div>');

// A shop with 13 numbered pages, each loading 36 products 12 at a time as you scroll. From page 4
// a banner sits above the grid inside an extra wrapper, so the grid's place on the page changes.
const pagedCard = (pg, i) => `<div class="product-card"><a href="/p/${pg}-${i}"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23${(0x446688 + pg * 977 + i * 131).toString(16).slice(-6)}'/%3E%3C/svg%3E" width="200" height="200" alt="Toner ${pg}-${i}"><h3 class="product-title">Heartleaf Toner ${pg}-${i} 250ml</h3></a><span class="price">$${(15 + (i % 7)).toFixed(2)}</span></div>`;
function shopPages(pg) {
  const all = Array.from({ length: 36 }, (_, i) => pagedCard(pg, i));
  const nums = Array.from({ length: 13 }, (_, k) => k + 1).map((n) => (n === pg ? `<span class="current" aria-current="page">${n}</span>` : `<a href="/shop-pages?page=${n}">${n}</a>`)).join(' ');
  const grid = `<div class="grid" id="grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">${all.slice(0, 12).join('')}</div>`;
  return html(`Toners page ${pg} | Glow Shop`, `<h1>Toners</h1>${pg >= 4 ? `<div class="promo"><p>Free shipping this week</p></div><section class="wrap"><div class="inner">${grid}</div></section>` : grid}
  <nav class="pagination">${pg > 1 ? `<a href="/shop-pages?page=${pg - 1}">Previous</a>` : ''} ${nums} ${pg < 13 ? `<a class="next" href="/shop-pages?page=${pg + 1}">Next</a>` : ''}</nav>
  <script>
    let shown = 12, busy = false;
    addEventListener('scroll', () => {
      if (busy || shown >= 36 || innerHeight + scrollY < document.body.scrollHeight - 400) return;
      busy = true;
      setTimeout(() => { document.getElementById('grid').insertAdjacentHTML('beforeend', ${JSON.stringify(all)}.slice(shown, shown + 12).join('')); shown += 12; busy = false; }, 500);
    });
  </script>`);
}

// A product page whose small thumbnails stand for big pictures: three swap the main picture when
// clicked, one links to its big file, one opens a lightbox (closed with Escape), and one is a
// related product linking to another page (must not be followed).
const IMG_CACHE = new Map();
const imgFile = (name) => {
  if (!IMG_CACHE.has(name)) {
    const [, key, size] = name.match(/^(\w)-(\d+)\.png$/) ?? [];
    const w = Number(size) || 100;
    const colors = { a: [220, 90, 90], b: [90, 160, 220], c: [120, 200, 120], d: [200, 170, 80], e: [170, 110, 200], f: [120, 120, 120] };
    IMG_CACHE.set(name, png(w, Math.round(w * 0.75), colors[key] ?? [200, 200, 200]));
  }
  return IMG_CACHE.get(name);
};
const galleryThumbs = html('Heartleaf Toner 250ml | Glow Shop', `<h1>Heartleaf Toner 250ml</h1><span class="price">$18.00</span>
  <div class="gallery"><img id="main" src="/img/a-400.png" width="400" height="300" alt="Heartleaf Toner">
    <div class="thumbs">${['a', 'b', 'c'].map((k) => `<img class="thumb" data-k="${k}" src="/img/${k}-120.png" width="90" height="68" alt="view ${k}">`).join('')}
      <a class="lb" href="/img/d-1600.png"><img src="/img/d-120.png" width="90" height="68" alt="view d"></a>
      <img id="zoom" src="/img/e-120.png" width="90" height="68" alt="view e">
    </div></div>
  <section class="related"><h2>You may also like</h2><a href="/other-product"><img src="/img/f-120.png" width="90" height="68" alt="Other toner"></a></section>
  <div id="box" role="dialog" aria-modal="true" hidden style="position:fixed;inset:40px;background:#000c;display:none"><img id="big" alt="zoomed"><button aria-label="Close">×</button></div>
  <script>
    for (const t of document.querySelectorAll('.thumb')) t.addEventListener('click', () => { document.getElementById('main').src = '/img/' + t.dataset.k + '-1600.png'; });
    const box = document.getElementById('box');
    document.getElementById('zoom').addEventListener('click', () => { document.getElementById('big').src = '/img/e-1500.png'; box.hidden = false; box.style.display = 'block'; });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') { box.hidden = true; box.style.display = 'none'; } });
    document.querySelector('.lb').addEventListener('click', (e) => e.preventDefault());
  </script>`);

// Google's review window as it really behaves: 10 more load only when the list moves down near
// its end (by script or by hand), every third request comes back empty, and opening "More" makes
// a review much longer a moment later. 60 reviews.
const gReview = (i) => {
  const stars = [5, 4, 5, 3, 5, 1, 5, 4, 2, 5][i % 10];
  return `<div class="bwb7ce" data-id="g${i}"><div class="who"><span>Guest ${i}</span><span class="sub">1 review · 0 photos</span></div>
    <div class="h3PQJ" role="img">${Array.from({ length: 5 }, (_, k) => `<svg width="14" height="14" viewBox="0 0 24 24"><path fill="${k < stars ? GOLD : GREY}" d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"/></svg>`).join('')}</div>
    <span class="m6Mr5d">${(i % 11) + 1} weeks ago</span>
    <div class="d83Iyc">Visit ${i}: ${stars >= 4 ? 'calm rooms and a skilled masseuse' : 'the room was cold'} … <span role="button" class="more" data-i="${i}">More</span></div>
    <span data-review-id="g${i}"></span></div>`;
};
const reviewsGoogle = html('tokyo spa - Search', `<div style="height:2400px"><h1>Results</h1><a id="pnnext" href="/page-two">Next</a></div>
  <div role="dialog" aria-modal="true" style="position:fixed;top:40px;left:120px;width:700px;height:600px;background:#fff;border:1px solid #ccc">
    <h2 role="heading">Tokyo Spa</h2>
    <div class="RVCQse" id="box" style="height:520px;overflow-y:auto">${Array.from({ length: 10 }, (_, i) => gReview(i)).join('')}</div>
  </div>
  <script>
    const box = document.getElementById('box');
    const all = ${JSON.stringify(Array.from({ length: 60 }, (_, i) => gReview(i)))};
    let shown = 10, busy = false, lastTop = 0, asks = 0;
    box.addEventListener('scroll', () => {
      const down = box.scrollTop > lastTop;
      lastTop = box.scrollTop;
      if (!down || busy || shown >= all.length || box.scrollTop + box.clientHeight < box.scrollHeight - 600) return;
      busy = true;
      asks++;
      setTimeout(() => { if (asks % 3 !== 0) { box.insertAdjacentHTML('beforeend', all.slice(shown, shown + 10).join('')); shown += 10; } busy = false; }, 500);
    });
    box.addEventListener('click', (e) => {
      const m = e.target.closest('.more');
      if (!m) return;
      setTimeout(() => { m.parentElement.textContent = 'Visit ' + m.dataset.i + ': ' + 'a long and detailed account of the visit, the rooms, the staff and the treatments. '.repeat(8); }, 300);
    });
  </script>`);

// Google Maps signed out: a few reviews, then "See more reviews (101,798)" asks you to sign in
const mapsLimited = html('Tokyo Spa - Google Maps', `<div class="side" style="position:fixed;left:0;top:0;width:420px;height:100vh;overflow-y:auto" id="side">
    <h1>Tokyo Spa</h1>${Array.from({ length: 5 }, (_, i) => gReview(i).replace(/ … <span role="button"[^<]*<\/span>/, '')).join('')}
    <button id="more" type="button">See more reviews (101,798)</button>
    <p>You're seeing a limited view of Google Maps. <a href="#">See more</a></p>
  </div>
  <div id="signin" role="dialog" style="display:none;position:fixed;top:120px;left:300px;width:360px;height:320px;background:#fff;border:1px solid #ccc"><p>Sign-in to get the best of Google Maps</p><p>Reviews &amp; photos: Read and search through every review and photo.</p><a href="https://accounts.google.com/ServiceLogin?continue=x">Sign in</a></div>
  <script>document.getElementById('more').onclick = () => { document.getElementById('signin').style.display = 'block'; };</script>`);

// Product pages with variants: Shopify theme JSON, WooCommerce variations, a schema.org product
// group, and one with no data where choosing a colour swaps the picture and price.
const productHead = (title, price) => `<h1>${title}</h1><span class="price">$${price}</span>`;
const variantPages = {
  shopify: html('Toner | Glow Shop', `${productHead('Heartleaf Toner', '18.00')}<img src="/img/a-600.png" width="400" alt="Toner"><button>Add to cart</button>
    <script type="application/json" data-product-json>${JSON.stringify({ title: 'Heartleaf Toner', options: ['Size'], variants: [
      { title: '100ml', option1: '100ml', sku: 'HT-100', price: 1800, available: true, featured_image: { src: '/img/a-600.png' } },
      { title: '250ml', option1: '250ml', sku: 'HT-250', price: 3200, compare_at_price: 3600, available: true, featured_image: { src: '/img/b-600.png' } },
      { title: '500ml', option1: '500ml', sku: 'HT-500', price: 5400, available: false, featured_image: { src: '/img/c-600.png' } },
    ] })}</script>`, ld({ '@type': 'Product', name: 'Heartleaf Toner', sku: 'HT', offers: { price: '18.00', priceCurrency: 'USD' } })),
  woo: html('Cushion | Glow Shop', `${productHead('Glow Cushion', '25.00')}<form class="variations_form" data-product_variations='${JSON.stringify([
    { attributes: { attribute_pa_shade: '21-light' }, sku: 'GC-21', display_price: 25, display_regular_price: 25, is_in_stock: true, image: { full_src: '/img/d-600.png' } },
    { attributes: { attribute_pa_shade: '23-natural' }, sku: 'GC-23', display_price: 25, display_regular_price: 28, is_in_stock: true, image: { full_src: '/img/e-600.png' } },
  ])}'><label for="pa_shade">Shade</label><select id="pa_shade"><option value="">Choose</option><option>21-light</option><option>23-natural</option></select><button>Add to cart</button></form>`, ld({ '@type': 'Product', name: 'Glow Cushion', sku: 'GC', offers: { price: '25.00', priceCurrency: 'USD' } })),
  schema: html('Lip tint | Glow Shop', productHead('Velvet Lip Tint', '12.00'), ld({ '@context': 'https://schema.org', '@type': 'ProductGroup', name: 'Velvet Lip Tint', variesBy: ['https://schema.org/color'], hasVariant: [
    { '@type': 'Product', name: 'Velvet Lip Tint Rose', color: 'Rose', sku: 'LT-RO', image: `${BASE}/img/f-600.png`, offers: { price: '12.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } },
    { '@type': 'Product', name: 'Velvet Lip Tint Coral', color: 'Coral', sku: 'LT-CO', image: `${BASE}/img/a-500.png`, offers: { price: '13.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } },
  ] })),
  click: html('Sun cream | Glow Shop', `<div class="product"><h1>Daily Sun Cream</h1><span class="price" id="price">$15.00</span>
    <img id="main" src="/img/a-900.png" width="420" alt="Sun cream">
    <label for="colour">Colour</label><select id="colour" name="option-colour"><option value="">Choose a colour</option><option value="a">Ivory</option><option value="b">Beige</option><option value="c">Sand</option></select>
    <button type="button">Add to cart</button></div>
    <script>document.getElementById('colour').addEventListener('change', (e) => { if (!e.target.value) return; document.getElementById('main').src = '/img/' + e.target.value + '-900.png'; document.getElementById('price').textContent = '$' + { a: '15.00', b: '16.00', c: '17.00' }[e.target.value]; });</script>`, ld({ '@type': 'Product', name: 'Daily Sun Cream', sku: 'SC', offers: { price: '15.00', priceCurrency: 'USD' } })),
};

const routes = {
  '/variant/shopify': () => variantPages.shopify,
  '/variant/woo': () => variantPages.woo,
  '/variant/schema': () => variantPages.schema,
  '/variant/click': () => variantPages.click,
  '/reviews-newest': () => reviewsGoogle.replace('<h2 role="heading">Tokyo Spa</h2>', '<h2 role="heading">Tokyo Spa</h2><div role="radiogroup" aria-label="Sort"><span role="radio" aria-checked="false">Most relevant</span> <span role="radio" aria-checked="true">Newest</span></div>'),
  '/gallery': () => gallery,
  '/gallery-thumbs': () => galleryThumbs,
  '/other-product': () => html('Other product', '<h1>Other toner</h1>'),
  '/reviews-google': () => reviewsGoogle,
  '/maps-limited': () => mapsLimited,
  '/hotels': () => hotels,
  '/directory': () => directory,
  '/news': () => newsHome,
  '/feed.xml': () => feed,
  '/company': () => company,
  '/contact': () => contact,
  '/about': () => html('About', '<p>Founded in Seoul.</p>'),
  '/tables': () => tables,
  '/reviews-scroll': () => reviewsScroll,
  '/reviews-more': () => reviewsMore,
  '/reviews-wheel': () => reviewsWheel,
  '/shop-scroll': () => shopScroll,
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, BASE);
    const p = url.pathname;
    const page = Number(url.searchParams.get('page') ?? 1);
    let body = null;
    let type = 'text/html; charset=utf-8';
    if (p === '/jobs/search') body = jobsPage(page);
    else if (p.startsWith('/jobs/view/')) body = jobView(p.split('/').pop());
    else if (p === '/homes') body = homesPage(page);
    else if (p.startsWith('/home/')) body = homeView(p.split('/').pop());
    else if (p === '/reviews') body = reviewsPage(page);
    else if (p === '/shop-pages') body = shopPages(Math.min(13, Math.max(1, page)));
    else if (p.startsWith('/img/')) {
      res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' });
      res.end(imgFile(p.slice(5)));
      return;
    }
    else if (p.startsWith('/news/2026/')) {
      const i = ARTICLES.findIndex(([slug]) => p.endsWith(slug));
      if (i >= 0) body = article(i);
    } else if (routes[p]) body = routes[p]();
    if (p === '/feed.xml') type = 'application/rss+xml; charset=utf-8';
    if (p.startsWith('/protected/')) {
      // Hotlink protection: only requests from this site's pages get the picture
      const ref = req.headers.referer ?? '';
      if (!ref.startsWith(BASE)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('hotlinking not allowed');
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' });
      res.end(PROTECTED);
      return;
    }
    if (body == null) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(html('Not found', '<h1>404</h1>'));
      return;
    }
    res.writeHead(200, { 'content-type': type, server: 'nginx/1.25.3' });
    res.end(body);
  })
  .listen(PORT, () => console.log('industry fixture on', PORT));
