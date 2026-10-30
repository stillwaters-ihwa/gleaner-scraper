// What a website is built with, from its HTML, script and style links, meta tags and response
// headers (and, on a live page, the scripts it has loaded). Signatures are deliberately specific,
// so a technology is only reported when there's clear evidence of it.

export interface Tech {
  name: string;
  category: string;
  version?: string;
  /** What gave it away, for the user to check. */
  evidence: string;
}

interface Sig {
  name: string;
  cat: string;
  /** Patterns in the raw HTML (including script and link URLs). */
  html?: RegExp[];
  /** <meta name="generator"> and similar. */
  meta?: [string, RegExp][];
  /** Response header name -> pattern. */
  headers?: [string, RegExp][];
  /** Global variables (live pages only). */
  globals?: string[];
  /** Pull a version out of the first match (group 1). */
  version?: RegExp;
}

const SIGS: Sig[] = [
  // E-commerce
  { name: 'Shopify', cat: 'E-commerce', html: [/cdn\.shopify\.com/, /Shopify\.theme/, /shopify-section/], headers: [['x-shopify-stage', /./], ['x-sorting-hat-shopid', /./]], globals: ['Shopify'] },
  { name: 'WooCommerce', cat: 'E-commerce', html: [/woocommerce/i, /wc-block/], meta: [['generator', /WooCommerce/i]], version: /WooCommerce ([\d.]+)/ },
  { name: 'Magento', cat: 'E-commerce', html: [/Magento_/, /mage\/cookies/, /text\/x-magento-init/] },
  { name: 'BigCommerce', cat: 'E-commerce', html: [/cdn\d*\.bigcommerce\.com/, /BCData/] },
  { name: 'PrestaShop', cat: 'E-commerce', html: [/prestashop/i], meta: [['generator', /PrestaShop/i]] },
  { name: 'OpenCart', cat: 'E-commerce', html: [/catalog\/view\/theme/, /route=product\/product/] },
  { name: 'Salesforce Commerce Cloud', cat: 'E-commerce', html: [/demandware\.(static|net)/, /dwanalytics/] },
  { name: 'Cafe24', cat: 'E-commerce', html: [/cafe24\.com/, /ec-base/, /EC_GLOBAL/] },
  { name: 'Shopline', cat: 'E-commerce', html: [/shoplineapp\.com|shopline\.(com|tw)/] },
  { name: 'Wix eCommerce', cat: 'E-commerce', html: [/wixstores/i] },
  { name: 'Square Online', cat: 'E-commerce', html: [/squareup\.com|editmysite\.com/] },
  { name: 'Ecwid', cat: 'E-commerce', html: [/app\.ecwid\.com|ecwid\.min\.js/] },
  // CMS and site builders
  { name: 'WordPress', cat: 'CMS', html: [/wp-content\//, /wp-includes\//, /wp-json/], meta: [['generator', /WordPress/i]], version: /WordPress ([\d.]+)/ },
  { name: 'Drupal', cat: 'CMS', html: [/sites\/default\/files/, /Drupal\.settings/, /drupal\.js/], meta: [['generator', /Drupal/i]], headers: [['x-generator', /Drupal/i]], version: /Drupal (\d+)/ },
  { name: 'Joomla', cat: 'CMS', html: [/\/media\/jui\//, /com_content/], meta: [['generator', /Joomla/i]] },
  { name: 'Wix', cat: 'Site builder', html: [/static\.wixstatic\.com/, /wix-warmup-data/], headers: [['x-wix-request-id', /./]] },
  { name: 'Squarespace', cat: 'Site builder', html: [/static1\.squarespace\.com/, /Static\.SQUARESPACE_CONTEXT/] },
  { name: 'Webflow', cat: 'Site builder', html: [/assets\.website-files\.com|webflow\.js/, /data-wf-page/], meta: [['generator', /Webflow/i]] },
  { name: 'Framer', cat: 'Site builder', html: [/framerusercontent\.com|framer\.com\/m\//] },
  { name: 'Ghost', cat: 'CMS', meta: [['generator', /Ghost/i]], version: /Ghost ([\d.]+)/ },
  { name: 'HubSpot CMS', cat: 'CMS', html: [/hs-sites\.com|hubspotusercontent/], meta: [['generator', /HubSpot/i]] },
  { name: 'Contentful', cat: 'CMS', html: [/ctfassets\.net/] },
  { name: 'Sanity', cat: 'CMS', html: [/cdn\.sanity\.io/] },
  { name: 'Notion', cat: 'Site builder', html: [/notion-static\.com|notion\.site/] },
  { name: 'Imweb', cat: 'Site builder', html: [/imweb\.me|imweb-static/] },
  // Frameworks and libraries
  { name: 'Next.js', cat: 'Framework', html: [/__NEXT_DATA__/, /\/_next\/static\//], headers: [['x-powered-by', /Next\.js/i]] },
  { name: 'Nuxt', cat: 'Framework', html: [/__NUXT__/, /\/_nuxt\//] },
  { name: 'Gatsby', cat: 'Framework', html: [/___gatsby/, /gatsby-/] },
  { name: 'Remix', cat: 'Framework', html: [/__remixContext/] },
  { name: 'Astro', cat: 'Framework', html: [/astro-island|\/_astro\//], meta: [['generator', /Astro/i]] },
  { name: 'SvelteKit', cat: 'Framework', html: [/__sveltekit|_app\/immutable/] },
  { name: 'Angular', cat: 'Framework', html: [/ng-version="([\d.]+)"/, /ng-app/], version: /ng-version="([\d.]+)"/ },
  { name: 'React', cat: 'Library', html: [/data-reactroot|react-dom(\.production)?\.min\.js|__REACT_DEVTOOLS/], globals: ['React'] },
  { name: 'Vue.js', cat: 'Library', html: [/vue(\.runtime)?(\.global)?(\.prod)?(\.min)?\.js|data-v-[0-9a-f]{8}/], globals: ['Vue'] },
  { name: 'jQuery', cat: 'Library', html: [/jquery[.-]?([\d.]+)?(\.min)?\.js/i], globals: ['jQuery'], version: /jquery[.-]([\d.]+\d)(?:\.min)?\.js/i },
  { name: 'Bootstrap', cat: 'UI framework', html: [/bootstrap(\.bundle)?(\.min)?\.(js|css)/i], version: /bootstrap@([\d.]+)/ },
  { name: 'Tailwind CSS', cat: 'UI framework', html: [/tailwindcss|cdn\.tailwindcss\.com/] },
  { name: 'Alpine.js', cat: 'Library', html: [/alpinejs|x-data="/] },
  { name: 'Lodash', cat: 'Library', html: [/lodash(\.min)?\.js/] },
  // Analytics and marketing
  { name: 'Google Analytics', cat: 'Analytics', html: [/google-analytics\.com\/(analytics|ga)\.js|googletagmanager\.com\/gtag\/js\?id=G-|gtag\(['"]config['"],\s*['"]G-/] },
  { name: 'Google Tag Manager', cat: 'Tag manager', html: [/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{5,}/] },
  { name: 'Google Ads', cat: 'Advertising', html: [/googleadservices\.com|AW-\d{6,}/] },
  { name: 'Meta Pixel', cat: 'Advertising', html: [/connect\.facebook\.net\/[\w_]+\/fbevents\.js|fbq\(['"]init/] },
  { name: 'TikTok Pixel', cat: 'Advertising', html: [/analytics\.tiktok\.com/] },
  { name: 'Pinterest Tag', cat: 'Advertising', html: [/s\.pinimg\.com\/ct\/core\.js|pintrk\(/] },
  { name: 'Microsoft Clarity', cat: 'Analytics', html: [/clarity\.ms\/tag/] },
  { name: 'Hotjar', cat: 'Analytics', html: [/static\.hotjar\.com|hotjar\.com\/c\/hotjar/] },
  { name: 'Mixpanel', cat: 'Analytics', html: [/cdn\.mxpnl\.com|mixpanel\.init/] },
  { name: 'Segment', cat: 'Analytics', html: [/cdn\.segment\.com\/analytics\.js/] },
  { name: 'Amplitude', cat: 'Analytics', html: [/cdn\.amplitude\.com/] },
  { name: 'Plausible', cat: 'Analytics', html: [/plausible\.io\/js/] },
  { name: 'Naver Analytics', cat: 'Analytics', html: [/wcs\.naver\.net\/wcslog\.js/] },
  { name: 'Kakao Pixel', cat: 'Advertising', html: [/t1\.daumcdn\.net\/kas\/static\/kp\.js|kakaoPixel/] },
  { name: 'HubSpot', cat: 'Marketing automation', html: [/js\.hs-scripts\.com|js\.hsforms\.net/] },
  { name: 'Klaviyo', cat: 'Email marketing', html: [/static\.klaviyo\.com|klaviyo\.js/] },
  { name: 'Mailchimp', cat: 'Email marketing', html: [/chimpstatic\.com|list-manage\.com/] },
  { name: 'Omnisend', cat: 'Email marketing', html: [/omnisnippet|omnisend\.com/] },
  // Customer support and chat
  { name: 'Intercom', cat: 'Live chat', html: [/widget\.intercom\.io|intercomSettings/] },
  { name: 'Zendesk', cat: 'Customer support', html: [/static\.zdassets\.com|zopim/] },
  { name: 'Tidio', cat: 'Live chat', html: [/code\.tidio\.co/] },
  { name: 'Crisp', cat: 'Live chat', html: [/client\.crisp\.chat/] },
  { name: 'Drift', cat: 'Live chat', html: [/js\.driftt\.com/] },
  { name: 'Channel Talk', cat: 'Live chat', html: [/cdn\.channel\.io|ChannelIO\(/] },
  { name: 'Gorgias', cat: 'Customer support', html: [/gorgias\.chat|config\.gorgias/] },
  // Payments and reviews
  { name: 'Stripe', cat: 'Payments', html: [/js\.stripe\.com/] },
  { name: 'PayPal', cat: 'Payments', html: [/paypal\.com\/sdk\/js|paypalobjects\.com/] },
  { name: 'Klarna', cat: 'Payments', html: [/klarna(services|cdn)?\.(com|net)/] },
  { name: 'Afterpay', cat: 'Payments', html: [/afterpay\.com|static\.afterpay/] },
  { name: 'Shop Pay', cat: 'Payments', html: [/shop-pay|shopify-pay/] },
  { name: 'Judge.me', cat: 'Reviews', html: [/judge\.me/] },
  { name: 'Yotpo', cat: 'Reviews', html: [/staticw2\.yotpo\.com|yotpo\.com/] },
  { name: 'Okendo', cat: 'Reviews', html: [/okendo\.io/] },
  { name: 'Trustpilot', cat: 'Reviews', html: [/widget\.trustpilot\.com/] },
  { name: 'Loox', cat: 'Reviews', html: [/loox\.io/] },
  // Hosting, CDN and security
  { name: 'Cloudflare', cat: 'CDN', headers: [['cf-ray', /./], ['server', /cloudflare/i]] },
  { name: 'Fastly', cat: 'CDN', headers: [['x-served-by', /cache-/i], ['via', /varnish/i]] },
  { name: 'Amazon CloudFront', cat: 'CDN', headers: [['x-amz-cf-id', /./], ['via', /CloudFront/i]] },
  { name: 'Akamai', cat: 'CDN', headers: [['x-akamai-transformed', /./], ['server', /AkamaiGHost/i]] },
  { name: 'Vercel', cat: 'Hosting', headers: [['x-vercel-id', /./], ['server', /Vercel/i]] },
  { name: 'Netlify', cat: 'Hosting', headers: [['x-nf-request-id', /./], ['server', /Netlify/i]] },
  { name: 'GitHub Pages', cat: 'Hosting', headers: [['server', /GitHub\.com/i]] },
  { name: 'Nginx', cat: 'Web server', headers: [['server', /nginx/i]], version: /nginx\/([\d.]+)/i },
  { name: 'Apache', cat: 'Web server', headers: [['server', /Apache/i]], version: /Apache\/([\d.]+)/i },
  { name: 'Microsoft IIS', cat: 'Web server', headers: [['server', /IIS/i]], version: /IIS\/([\d.]+)/i },
  { name: 'LiteSpeed', cat: 'Web server', headers: [['server', /LiteSpeed/i]] },
  { name: 'PHP', cat: 'Language', headers: [['x-powered-by', /PHP/i]], version: /PHP\/([\d.]+)/i },
  { name: 'ASP.NET', cat: 'Framework', headers: [['x-powered-by', /ASP\.NET/i], ['x-aspnet-version', /./]], html: [/__VIEWSTATE/] },
  { name: 'Google reCAPTCHA', cat: 'Security', html: [/google\.com\/recaptcha|recaptcha\/api\.js/] },
  { name: 'hCaptcha', cat: 'Security', html: [/hcaptcha\.com\/1\/api\.js/] },
  { name: 'Cloudflare Turnstile', cat: 'Security', html: [/challenges\.cloudflare\.com\/turnstile/] },
  { name: 'Google Fonts', cat: 'Fonts', html: [/fonts\.googleapis\.com/] },
  { name: 'Font Awesome', cat: 'Fonts', html: [/font-?awesome/i] },
  { name: 'Cookiebot', cat: 'Cookie consent', html: [/consent\.cookiebot\.com/] },
  { name: 'OneTrust', cat: 'Cookie consent', html: [/cdn\.cookielaw\.org|onetrust/i] },
];

/** Technologies found in a page's HTML and response headers. */
export function detectTech(html: string, headers: Record<string, string> = {}, globals: string[] = []): Tech[] {
  const out: Tech[] = [];
  const doc = new DOMParser().parseFromString(html.slice(0, 3_000_000), 'text/html');
  const metas = new Map<string, string>();
  for (const m of Array.from(doc.querySelectorAll('meta[name], meta[property]'))) metas.set((m.getAttribute('name') ?? m.getAttribute('property'))!.toLowerCase(), m.getAttribute('content') ?? '');
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  for (const s of SIGS) {
    let evidence = '';
    let source = '';
    for (const [name, re] of s.meta ?? []) if (!evidence && re.test(metas.get(name) ?? '')) ((evidence = `meta ${name}: ${metas.get(name)}`), (source = metas.get(name)!));
    for (const [name, re] of s.headers ?? []) if (!evidence && h[name] && re.test(h[name])) ((evidence = `header ${name}: ${h[name].slice(0, 60)}`), (source = h[name]));
    for (const re of s.html ?? []) {
      if (evidence) break;
      const m = html.match(re);
      if (m) ((evidence = `page code: ${m[0].slice(0, 60)}`), (source = m[0]));
    }
    for (const g of s.globals ?? []) if (!evidence && globals.includes(g)) evidence = `loaded: window.${g}`;
    if (!evidence) continue;
    const version = s.version ? (source.match(s.version)?.[1] ?? html.match(s.version)?.[1]) : undefined;
    out.push({ name: s.name, category: s.cat, version, evidence });
  }
  return out;
}

/** Global variables worth checking on a live page. */
export const TECH_GLOBALS = [...new Set(SIGS.flatMap((s) => s.globals ?? []))];
