// @vitest-environment happy-dom
// Industry readers against realistic page samples: the structured data and embedded app data
// that job boards, property portals, news sites, travel sites and directories publish.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atsJobs, atsLinksInPage, detectAts, extractJobs, parseSalary, seniorityOf } from '@/lib/verticals/jobs';
import { extractProperties, roomsFromText } from '@/lib/verticals/realestate';
import { articleLinks, extractArticle, feedLinks, looksLikeArticle, parseFeed } from '@/lib/verticals/news';
import { extractBusinesses, extractTravel } from '@/lib/verticals/places';
import { extractReviews, summarizeReviews } from '@/lib/verticals/reviews';
import { parseTelegramPage, redditTarget, telegramChannel, tumblrFeed } from '@/lib/verticals/social';
import { embeddedJson, isoDate, pick, recordArrays, toNum } from '@/lib/verticals/structured';
import { keywords, sentiment } from '@/lib/verticals/sentiment';

const page = (head: string, body = '') => new DOMParser().parseFromString(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, 'text/html');
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const NOW = Date.UTC(2026, 9, 16);

describe('structured data helpers', () => {
  it('reads numbers with separators and K/M suffixes', () => {
    expect(toNum('$1,234.50')).toBe(1234.5);
    expect(toNum('450K')).toBe(450000);
    expect(toNum('1.2M')).toBe(1200000);
    expect(toNum('none')).toBeNull();
  });
  it('turns dates, timestamps and "3 days ago" into YYYY-MM-DD', () => {
    expect(isoDate('2026-10-01T09:00:00Z')).toBe('2026-10-01');
    expect(isoDate(1790000000)).toBe('2026-09-21');
    expect(isoDate('3 days ago', NOW)).toBe('2026-10-13');
    expect(isoDate('Just posted', NOW)).toBe('2026-10-16');
    expect(isoDate('not a date')).toBe('');
  });
  it('picks values by loose key names, including nested ones', () => {
    expect(pick({ hdpData: { homeInfo: { bedrooms: 3 } } }, ['beds', 'bedrooms'], 2)).toBe(3);
    expect(pick({ Unformatted_Price: 5 }, ['unformattedPrice'])).toBe(5);
  });
  it('finds JSON assigned to window variables and in JSON script tags', () => {
    const doc = page('', `<script>window.__STATE__ = {"items":[{"a":1},{"a":2}]}; window.x = 1;</script><script id="__NEXT_DATA__" type="application/json">{"props":{"n":1}}</script>`.padEnd(400, ' '));
    // padding keeps the scripts above the small-script cut-off
    const doc2 = page('', `<script>window.__STATE__ = {"items":[{"a":1},{"a":2}],"pad":"${'x'.repeat(300)}"};</script><script id="__NEXT_DATA__" type="application/json">{"props":{"n":1},"pad":"${'x'.repeat(300)}"}</script>`);
    const found = embeddedJson(doc2);
    expect(found.some((j) => j.items?.length === 2)).toBe(true);
    expect(found.some((j) => j.props?.n === 1)).toBe(true);
    expect(embeddedJson(doc)).toEqual([]);
  });
  it('ranks arrays of records by how well they fit', () => {
    const data = { a: [{ x: 1 }, { x: 2 }], b: { list: [{ title: 't', company: 'c' }, { title: 'u', company: 'd' }, { title: 'v', company: 'e' }] } };
    const [best] = recordArrays([data], (o) => (o.title && o.company ? 1 : 0), 2);
    expect(best).toHaveLength(3);
  });
});

describe('jobs', () => {
  it('reads a JobPosting on a job page, with salary, workplace and location', () => {
    const doc = page(
      ld({
        '@context': 'https://schema.org',
        '@type': 'JobPosting',
        title: 'Senior Data Engineer',
        hiringOrganization: { '@type': 'Organization', name: 'Speechify' },
        jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Dublin', addressCountry: 'IE' } }],
        jobLocationType: 'TELECOMMUTE',
        employmentType: ['FULL_TIME'],
        baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: { minValue: 130000, maxValue: 170000, unitText: 'YEAR' } },
        datePosted: '2026-10-01',
        validThrough: '2026-12-01T00:00',
        description: '<p>Build <b>pipelines</b> &amp; more.</p>',
      }),
    );
    const [job] = extractJobs(doc, 'https://jobs.example.com/123');
    expect(job).toMatchObject({
      title: 'Senior Data Engineer',
      company: 'Speechify',
      location: 'Dublin, IE',
      workplace: 'remote',
      employment_type: 'full-time',
      salary_min: '130000',
      salary_max: '170000',
      salary_currency: 'USD',
      salary_period: 'year',
      date_posted: '2026-10-01',
      valid_through: '2026-12-01',
      url: 'https://jobs.example.com/123',
    });
    expect(job.description).toBe('Build pipelines & more.');
    expect(job.salary).toBe('USD 130,000 - 170,000 per year');
  });

  it('reads search results from a job board\'s embedded page data', () => {
    const results = Array.from({ length: 4 }, (_, i) => ({
      jobkey: `abc${i}`,
      displayTitle: `Esthetician ${i}`,
      company: 'Glow Spa',
      formattedLocation: 'Austin, TX',
      salarySnippet: { text: '$20 - $28 an hour' },
      formattedRelativeTime: '2 days ago',
      jobTypes: ['Part-time'],
    }));
    const doc = page('', `<script>window.mosaic = {}; window.mosaic.providerData = {"results": ${JSON.stringify(results)}, "pad": "${'x'.repeat(300)}"};</script>`);
    const jobs = extractJobs(doc, 'https://www.indeed.com/jobs?q=esthetician');
    expect(jobs).toHaveLength(4);
    expect(jobs[0]).toMatchObject({ title: 'Esthetician 0', company: 'Glow Spa', location: 'Austin, TX', salary_min: '20', salary_max: '28', salary_period: 'hour', salary_currency: 'USD', employment_type: 'part-time' });
    expect(jobs[0].url).toBe('https://www.indeed.com/viewjob?jk=abc0');
  });

  it('parses salary text in several styles', () => {
    expect(parseSalary('$80,000 - $120,000 a year')).toEqual({ min: '80000', max: '120000', currency: 'USD', period: 'year' });
    expect(parseSalary('€25/hour')).toEqual({ min: '25', max: '25', currency: 'EUR', period: 'hour' });
    expect(parseSalary('₩40M ~ 60M')).toMatchObject({ min: '40000000', max: '60000000', currency: 'KRW', period: 'year' });
    expect(parseSalary('$95K-$110K')).toMatchObject({ min: '95000', max: '110000', period: 'year' });
  });

  it('recognises company hiring-system links', () => {
    expect(detectAts('https://boards.greenhouse.io/airbnb')).toEqual({ ats: 'greenhouse', slug: 'airbnb' });
    expect(detectAts('https://job-boards.greenhouse.io/speechify/jobs/5975137004')).toEqual({ ats: 'greenhouse', slug: 'speechify' });
    expect(detectAts('https://jobs.lever.co/palantir')).toEqual({ ats: 'lever', slug: 'palantir' });
    expect(detectAts('https://jobs.ashbyhq.com/openai')).toEqual({ ats: 'ashby', slug: 'openai' });
    expect(detectAts('https://jobs.smartrecruiters.com/Visa')).toEqual({ ats: 'smartrecruiters', slug: 'Visa' });
    expect(detectAts('https://acme.recruitee.com/')).toEqual({ ats: 'recruitee', slug: 'acme' });
    expect(detectAts('lever:palantir')).toEqual({ ats: 'lever', slug: 'palantir' });
    expect(detectAts('https://example.com/careers')).toBeNull();
    expect(atsLinksInPage('<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe> <a href="https://jobs.lever.co/acme">Jobs</a>')).toEqual([
      'https://boards.greenhouse.io/embed/job_board?for=acme',
      'https://jobs.lever.co/acme',
    ]);
  });

  it('labels seniority from titles', () => {
    expect(seniorityOf('Sr. Product Designer')).toBe('senior');
    expect(seniorityOf('Staff Engineer')).toBe('principal');
    expect(seniorityOf('Marketing Intern')).toBe('intern');
  });

  describe('company job boards', () => {
    afterEach(() => vi.unstubAllGlobals());
    const stub = (byUrl: Record<string, unknown>) =>
      vi.stubGlobal('fetch', async (url: string) => {
        const key = Object.keys(byUrl).find((k) => String(url).includes(k));
        if (!key) return new Response('', { status: 404 });
        return new Response(JSON.stringify(byUrl[key]), { status: 200 });
      });

    it('maps Greenhouse jobs', async () => {
      stub({
        '/boards/acme/jobs': { jobs: [{ title: 'Cosmetic Chemist', location: { name: 'Seoul, South Korea' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', first_published: '2026-09-30T10:00:00Z', departments: [{ name: 'R&D' }], content: '&lt;p&gt;Formulate&lt;/p&gt;', metadata: [] }] },
        '/boards/acme': { name: 'Acme Beauty' },
      });
      const [j] = await atsJobs('greenhouse', 'acme');
      expect(j).toMatchObject({ title: 'Cosmetic Chemist', company: 'Acme Beauty', location: 'Seoul, South Korea', department: 'R&D', date_posted: '2026-09-30', description: 'Formulate', url: 'https://boards.greenhouse.io/acme/jobs/1', source: 'Greenhouse job board' });
    });

    it('maps Lever jobs with salary ranges', async () => {
      stub({ '/postings/acme': [{ text: 'Brand Manager', categories: { location: 'New York', commitment: 'Full-time', team: 'Marketing' }, workplaceType: 'hybrid', hostedUrl: 'https://jobs.lever.co/acme/1', applyUrl: 'https://jobs.lever.co/acme/1/apply', createdAt: 1790000000000, descriptionPlain: 'Lead the brand.', salaryRange: { min: 90000, max: 120000, currency: 'USD', interval: 'per-year-salary' } }] });
      const [j] = await atsJobs('lever', 'acme');
      expect(j).toMatchObject({ title: 'Brand Manager', location: 'New York', workplace: 'hybrid', employment_type: 'full-time', department: 'Marketing', salary_min: '90000', salary_max: '120000', salary_currency: 'USD', date_posted: '2026-09-21' });
    });

    it('explains a company name that has no board', async () => {
      stub({});
      await expect(atsJobs('ashby', 'nobody')).rejects.toThrow(/No job board found/);
    });
  });
});

describe('real estate', () => {
  it('reads every listing from a portal\'s search page data', () => {
    const listResults = [
      { zpid: '101', price: '$450,000', unformattedPrice: 450000, addressStreet: '12 Oak St', addressCity: 'Austin', addressState: 'TX', addressZipcode: '78701', beds: 3, baths: 2, area: 1500, statusText: 'House for sale', detailUrl: '/homedetails/101_zpid/', imgSrc: 'https://img/1.jpg', latLong: { latitude: 30.26, longitude: -97.74 }, brokerName: 'Lone Star Realty', hdpData: { homeInfo: { homeType: 'SINGLE_FAMILY', daysOnZillow: 12 } } },
      { zpid: '102', price: '$2,100/mo', unformattedPrice: 2100, addressStreet: '5 Elm Ave', addressCity: 'Austin', addressState: 'TX', addressZipcode: '78702', beds: 1, baths: 1, area: 700, statusText: 'Apartment for rent', detailUrl: '/homedetails/102_zpid/', latLong: { latitude: 30.27, longitude: -97.72 } },
    ];
    const doc = page('', `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { searchPageState: { cat1: { searchResults: { listResults } } } } }, pad: 'x'.repeat(300) })}</script>`);
    const homes = extractProperties(doc, 'https://www.zillow.com/austin-tx/');
    expect(homes).toHaveLength(2);
    expect(homes[0]).toMatchObject({
      address: '12 Oak St',
      city: 'Austin',
      region: 'TX',
      postal_code: '78701',
      price: '450000',
      status: 'for sale',
      home_type: 'single family',
      beds: '3',
      baths: '2',
      area: '1500',
      area_unit: 'sqft',
      price_per_area: '300',
      days_on_market: '12',
      broker: 'Lone Star Realty',
      listing_id: '101',
      latitude: '30.26',
      longitude: '-97.74',
      url: 'https://www.zillow.com/homedetails/101_zpid/',
    });
    expect(homes[1].status).toBe('for rent');
  });

  it('reads one home described with schema.org on its listing page', () => {
    const doc = page(
      ld({
        '@context': 'https://schema.org',
        '@type': ['SingleFamilyResidence', 'Product'],
        name: '742 Evergreen Terrace',
        address: { '@type': 'PostalAddress', streetAddress: '742 Evergreen Terrace', addressLocality: 'Springfield', addressRegion: 'OR', postalCode: '97477' },
        numberOfBedrooms: 4,
        numberOfBathroomsTotal: 2.5,
        floorSize: { '@type': 'QuantitativeValue', value: 2200, unitCode: 'FTK' },
        yearBuilt: 1989,
        geo: { latitude: 44.05, longitude: -123.02 },
        offers: { '@type': 'Offer', price: 525000, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      }),
    );
    const [home] = extractProperties(doc, 'https://www.redfin.com/OR/Springfield/742-Evergreen-Terrace/home/1');
    expect(home).toMatchObject({ address: '742 Evergreen Terrace, Springfield, OR 97477', price: '525000', currency: 'USD', beds: '4', baths: '2.5', area: '2200', year_built: '1989', price_per_area: '239', home_type: 'SingleFamilyResidence' });
  });

  it('reads beds, baths and area from card text', () => {
    expect(roomsFromText('3 bds | 2 ba | 1,540 sqft - House for sale')).toEqual({ beds: '3', baths: '2', area: '1540', area_unit: 'sqft' });
    expect(roomsFromText('Studio · 1 bath · 38 m²')).toEqual({ beds: '0', baths: '1', area: '38', area_unit: 'm²' });
  });
});

describe('news and content', () => {
  const article = page(
    `<title>Site title</title><meta property="og:site_name" content="Beauty Daily"><link rel="canonical" href="https://news.example.com/2026/10/15/k-beauty-exports-surge-record-year">
     <link rel="alternate" type="application/rss+xml" href="/feed.xml">
     ${ld({ '@type': 'NewsArticle', headline: 'K-beauty exports surge to a record year', author: [{ '@type': 'Person', name: 'Min-ji Park' }], datePublished: '2026-10-15T08:00:00+09:00', dateModified: '2026-10-15T12:00:00+09:00', publisher: { '@type': 'Organization', name: 'Beauty Daily' }, articleSection: 'Industry', keywords: ['exports', 'k-beauty'] })}`,
    `<nav><a href="/2026/10/14/another-story-about-something-big">Nav link that should be ignored</a></nav>
     <article><h1>K-beauty exports surge to a record year</h1>${'<p>Korean cosmetics exports rose strongly this year as demand for sunscreen and serums grew across the United States and Europe. Brands reported excellent sales and record growth, while analysts warned of risks from higher costs.</p>'.repeat(6)}
     <a href="https://news.example.com/2026/10/14/sunscreen-demand-grows-in-europe">Sunscreen demand grows in Europe this summer</a>
     <a href="https://news.example.com/tag/skincare">Skincare tag page link text</a>
     <a href="https://news.example.com/business/brands-expand-into-us-retail-stores-nationwide">Brands expand into US retail stores nationwide</a></article>`,
  );

  it('reads an article with author, dates, publisher, text and sentiment', () => {
    const a = extractArticle(article, 'https://news.example.com/x');
    expect(a).toMatchObject({ title: 'K-beauty exports surge to a record year', author: 'Min-ji Park', published: '2026-10-14', updated: '2026-10-15', publisher: 'Beauty Daily', section: 'Industry', tags: 'exports, k-beauty', url: 'https://news.example.com/2026/10/15/k-beauty-exports-surge-record-year', source: 'article data' });
    expect(Number(a.word_count)).toBeGreaterThan(150);
    expect(a.sentiment).toBe('positive');
    expect(a.keywords).toMatch(/exports|cosmetics/);
  });

  it('finds article links but not navigation, tags or sections', () => {
    expect(articleLinks(article, 'https://news.example.com/').map((l) => l.url)).toEqual([
      'https://news.example.com/2026/10/14/sunscreen-demand-grows-in-europe',
      'https://news.example.com/business/brands-expand-into-us-retail-stores-nationwide',
    ]);
    expect(looksLikeArticle('https://news.example.com/category/beauty', 'https://news.example.com')).toBe(false);
    expect(looksLikeArticle('https://other.com/2026/10/14/x', 'https://news.example.com')).toBe(false);
    expect(feedLinks(article, 'https://news.example.com/')).toEqual(['https://news.example.com/feed.xml']);
  });

  it('reads RSS and Atom feeds', () => {
    const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Beauty Daily</title>
      <item><title>Record exports</title><link>https://news.example.com/a</link><pubDate>Wed, 15 Oct 2026 08:00:00 GMT</pubDate><dc:creator>Min-ji Park</dc:creator><category>Industry</category><description>&lt;p&gt;Great growth for brands.&lt;/p&gt;</description></item>
    </channel></rss>`;
    expect(parseFeed(rss, 'https://news.example.com/feed.xml')[0]).toMatchObject({ title: 'Record exports', url: 'https://news.example.com/a', published: '2026-10-15', author: 'Min-ji Park', publisher: 'Beauty Daily', tags: 'Industry', summary: 'Great growth for brands.', sentiment: 'positive' });
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><entry><title>Post</title><link href="https://b.example.com/p"/><updated>2026-10-01T00:00:00Z</updated><summary>Terrible launch, a disaster.</summary></entry></feed>`;
    expect(parseFeed(atom, 'https://b.example.com/atom')[0]).toMatchObject({ title: 'Post', url: 'https://b.example.com/p', published: '2026-10-01', sentiment: 'negative' });
    expect(() => parseFeed('<html><p>not xml', 'https://x')).toThrow(/RSS or Atom/);
  });
});

describe('travel and business listings', () => {
  it('reads hotels from a list of schema.org items', () => {
    const doc = page(
      ld({
        '@type': 'ItemList',
        itemListElement: [
          { '@type': 'ListItem', item: { '@type': 'Hotel', name: 'Lotte Hotel Seoul', aggregateRating: { ratingValue: 4.5, reviewCount: 6000 }, starRating: { ratingValue: 5 }, priceRange: '$$$', address: { addressLocality: 'Seoul', addressCountry: 'KR' }, amenityFeature: [{ name: 'Pool' }, { name: 'Free WiFi' }] } },
          { '@type': 'ListItem', item: { '@type': 'Restaurant', name: 'Mingles', servesCuisine: 'Korean', aggregateRating: { ratingValue: 4.8, reviewCount: 900 }, telephone: '+82 2-515-7306', address: { streetAddress: '19 Dosan-daero 67-gil', addressLocality: 'Seoul' } } },
        ],
      }),
    );
    const places = extractTravel(doc, 'https://www.tripadvisor.com/Hotels-Seoul');
    expect(places).toHaveLength(2);
    expect(places[0]).toMatchObject({ name: 'Lotte Hotel Seoul', type: 'hotel', rating: '4.5', review_count: '6000', stars: '5', price_range: '$$$', city: 'Seoul', country: 'KR', amenities: 'Pool, Free WiFi' });
    expect(places[1]).toMatchObject({ name: 'Mingles', cuisine: 'Korean', phone: '+82 2-515-7306' });
  });

  it('reads local businesses but not the directory describing itself', () => {
    const doc = page(
      ld({ '@type': 'Organization', name: 'Directory Inc', url: 'https://dir.example.com' }) +
        ld({ '@type': 'Plumber', name: 'Ace Plumbing', telephone: '(512) 555-0134', email: 'mailto:hello@aceplumbing.com', address: { streetAddress: '9 Main St', addressLocality: 'Austin', addressRegion: 'TX', postalCode: '78701' }, aggregateRating: { ratingValue: 4.7, reviewCount: 88 }, openingHours: ['Mo-Fr 08:00-18:00'], foundingDate: '2006', sameAs: 'https://aceplumbing.com' }),
    );
    const [b, ...rest] = extractBusinesses(doc, 'https://dir.example.com/austin/plumbers');
    expect(rest).toHaveLength(0);
    expect(b).toMatchObject({ name: 'Ace Plumbing', category: 'plumber', phone: '(512) 555-0134', email: 'hello@aceplumbing.com', website: 'https://aceplumbing.com/', city: 'Austin', region: 'TX', rating: '4.7', review_count: '88', hours: 'Mo-Fr 08:00-18:00' });
    expect(Number(b.years_in_business)).toBeGreaterThanOrEqual(20);
  });
});

describe('reviews', () => {
  it('reads Amazon review blocks without reviewer names', () => {
    const block = (stars: number, title: string, body: string, verified = true) => `<div data-hook="review"><span class="a-profile-name">Jane Q</span><i data-hook="review-star-rating"><span>${stars}.0 out of 5 stars</span></i><a data-hook="review-title"><span>${stars}.0 out of 5 stars</span><span>${title}</span></a><span data-hook="review-date">Reviewed in the United States on March 3, 2026</span>${verified ? '<span data-hook="avp-badge">Verified Purchase</span>' : ''}<span data-hook="review-body"><span>${body}</span></span><span data-hook="helpful-vote-statement">12 people found this helpful</span></div>`;
    const doc = page('', `<span id="productTitle">Heartleaf Toner</span>${block(5, 'Love it', 'Gentle and soothing, my skin feels amazing.')}${block(1, 'Broke me out', 'Terrible rash and irritation after two days.', false)}`);
    const rows = extractReviews(doc, 'https://www.amazon.com/product-reviews/B0X');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rating: '5', title: 'Love it', date: '2026-03-03', verified: 'yes', helpful: '12', product: 'Heartleaf Toner', sentiment: 'positive' });
    expect(rows[1]).toMatchObject({ rating: '1', sentiment: 'negative' });
    expect(JSON.stringify(rows)).not.toContain('Jane');
  });

  it('summarizes ratings, sentiment, praise and complaints', () => {
    const r = (rating: string, text: string) => ({ rating, text, sentiment: sentiment(text).label });
    const s = summarizeReviews([
      r('5', 'gentle formula, soothing and calming'),
      r('5', 'gentle formula, love the soothing feel'),
      r('4', 'gentle formula works well'),
      r('1', 'strong smell and sticky texture, bad'),
      r('2', 'strong smell, sticky texture'),
    ]);
    expect(s).toMatchObject({ count: 5, average: 3.4, distribution: { '1': 1, '2': 1, '3': 0, '4': 1, '5': 2 } });
    expect(s.praise).toContain('gentle formula');
    expect(s.complaints).toEqual(expect.arrayContaining(['strong smell', 'sticky texture']));
  });
});

describe('social', () => {
  it('reads a public Telegram channel page', () => {
    const msg = (id: number, text: string, views: string) => `<div class="tgme_widget_message" data-post="kbeautynews/${id}"><div class="tgme_widget_message_text">${text}</div><span class="tgme_widget_message_views">${views}</span><a class="tgme_widget_message_date" href="https://t.me/kbeautynews/${id}"><time datetime="2026-10-1${id % 10}T09:30:00+00:00"></time></a></div>`;
    const html = `<div class="tgme_channel_info_header_title">K-Beauty News</div><div class="tgme_channel_info_counter"><span class="counter_value">12.4K</span> subscribers</div>${msg(41, 'New launch <a href="https://shop.example.com/x">shop</a>', '1.2K')}${msg(42, 'Great sale today', '980')}`;
    const p = parseTelegramPage(html, 'kbeautynews');
    expect(p.title).toBe('K-Beauty News');
    expect(p.subscribers).toBe('12.4K subscribers');
    expect(p.before).toBe(41);
    expect(p.posts.map((x) => x.url)).toEqual(['https://t.me/kbeautynews/42', 'https://t.me/kbeautynews/41']);
    expect(p.posts[1]).toMatchObject({ views: '1200', link: 'https://shop.example.com/x', date: '2026-10-11 09:30:00' });
  });

  it('understands Telegram, Reddit and Tumblr inputs', () => {
    expect(telegramChannel('https://t.me/s/durov')).toBe('durov');
    expect(telegramChannel('@durov')).toBe('durov');
    expect(redditTarget('r/SkincareAddiction', 'top')?.url).toBe('https://www.reddit.com/r/SkincareAddiction/top.json?limit=100&t=month');
    expect(redditTarget('https://www.reddit.com/r/AsianBeauty/comments/abc123/my_routine/', 'hot')).toEqual({ url: 'https://www.reddit.com/r/AsianBeauty/comments/abc123/my_routine.json?limit=200', kind: 'thread' });
    expect(redditTarget('snail mucin review', 'new')?.url).toBe('https://www.reddit.com/search.json?q=snail%20mucin%20review&limit=100&sort=new');
    expect(tumblrFeed('https://staff.tumblr.com')).toBe('https://staff.tumblr.com/rss');
    expect(tumblrFeed('tumblr.com/staff')).toBe('https://staff.tumblr.com/rss');
  });
});

describe('sentiment and keywords', () => {
  it('scores positive, negative and negated text', () => {
    expect(sentiment('This serum is amazing, I love it').label).toBe('positive');
    expect(sentiment('Awful smell and a terrible rash').label).toBe('negative');
    expect(sentiment('Not good at all').label).toBe('negative');
    expect(sentiment('The box arrived on Tuesday').label).toBe('neutral');
  });
  it('finds repeated phrases', () => {
    expect(keywords(['snail mucin essence works', 'love this snail mucin', 'snail mucin is great'], 3)[0]).toBe('snail mucin');
  });
});

describe('Reddit RSS fallback', () => {
  it('maps listing, search and thread addresses to their feeds', async () => {
    const { redditRssUrl } = await import('@/lib/verticals/social');
    expect(redditRssUrl('https://www.reddit.com/r/AsianBeauty/hot.json?limit=100')).toBe('https://www.reddit.com/r/AsianBeauty/hot/.rss');
    expect(redditRssUrl('https://www.reddit.com/search.json?q=snail%20mucin&limit=100&sort=new')).toBe('https://www.reddit.com/search.rss?q=snail+mucin&sort=new');
    expect(redditRssUrl('https://www.reddit.com/r/AsianBeauty/comments/abc/x.json?limit=200')).toBe('https://www.reddit.com/r/AsianBeauty/comments/abc/x/.rss');
  });
  it('reads posts from the feed and drops the "submitted by" footer', async () => {
    const { parseRedditRss } = await import('@/lib/verticals/social');
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><author><name>/u/glowfan</name></author><category term="AsianBeauty" label="r/AsianBeauty"/><content type="html">&lt;div class="md"&gt;&lt;p&gt;Love this snail essence, amazing results.&lt;/p&gt;&lt;/div&gt; &lt;span&gt; submitted by &lt;a href="https://www.reddit.com/user/glowfan"&gt; /u/glowfan &lt;/a&gt;&lt;/span&gt; &lt;span&gt;&lt;a href="https://www.reddit.com/r/AsianBeauty/comments/abc/x/"&gt;[comments]&lt;/a&gt;&lt;/span&gt;</content><link href="https://www.reddit.com/r/AsianBeauty/comments/abc/x/"/><published>2026-10-15T09:30:00+00:00</published><title>Snail essence review</title></entry></feed>`;
    expect(parseRedditRss(xml)).toEqual([
      { platform: 'Reddit', channel: 'r/AsianBeauty', author: 'u/glowfan', title: 'Snail essence review', text: 'Love this snail essence, amazing results.', date: '2026-10-15 09:30', url: 'https://www.reddit.com/r/AsianBeauty/comments/abc/x/', sentiment: 'positive' },
    ]);
  });
});

describe('keyword phrases', () => {
  it('never joins words across a comma', () => {
    const k = keywords(['strong smell, sticky texture', 'strong smell, sticky texture', 'sticky texture and strong smell'], 10);
    expect(k).toEqual(expect.arrayContaining(['strong smell', 'sticky texture']));
    expect(k).not.toContain('smell sticky');
  });
});

describe('room sizes stated in listings', () => {
  it('reads metric, feet-and-inches and bare sizes', async () => {
    const { parseRoomSizes } = await import('@/lib/verticals/rooms');
    const uk = parseRoomSizes("Kitchen 4.20m x 3.10m. Living Room: 5.5m x 3.9m (18'1\" x 12'10\"). Bedroom 1 - 3.6 x 3.2 m. Bathroom 2.1m x 1.9m. Total 85 m²");
    expect(uk.map((r) => [r.name, r.length_m, r.width_m, r.area_m2])).toEqual([
      ['Kitchen', 4.2, 3.1, 13],
      ['Living Room', 5.5, 3.9, 21.5],
      ['Bedroom 1', 3.6, 3.2, 11.5],
      ['Bathroom', 2.1, 1.9, 4],
    ]);
    const us = parseRoomSizes("Primary Bedroom: 15' 2\" x 12' 0\". Family room 18 x 14. Kitchen 13x11 ft. 2,100 sq ft home");
    expect(us.map((r) => [r.name, r.length_m, r.width_m])).toEqual([
      ['Primary Bedroom', 4.62, 3.66],
      ['Family room', 5.49, 4.27],
      ['Kitchen', 3.96, 3.35],
    ]);
  });
  it('ignores numbers that are not room sizes', async () => {
    const { parseRoomSizes } = await import('@/lib/verticals/rooms');
    expect(parseRoomSizes('3 bedrooms x 2 bathrooms, built 1998, lot 50 x 120 ft')).toEqual([]);
    expect(parseRoomSizes('Bedroom 1 3.5 x 3.5m and again Bedroom 1 3.5 x 3.5m')).toHaveLength(1);
  });
});

describe('review photos', () => {
  it('asks for the full-size photo', async () => {
    const { fullSizePhoto } = await import('@/lib/verticals/reviews');
    expect(fullSizePhoto('https://lh3.googleusercontent.com/grass-cs/AABkm=s125-p-k-rw')).toBe('https://lh3.googleusercontent.com/grass-cs/AABkm=s1600');
    expect(fullSizePhoto('https://m.media-amazon.com/images/I/71abc._SY88.jpg')).toBe('https://m.media-amazon.com/images/I/71abc.jpg');
    expect(fullSizePhoto('https://shop.test/uploads/pic-150x150.jpg')).toBe('https://shop.test/uploads/pic.jpg');
  });
});
