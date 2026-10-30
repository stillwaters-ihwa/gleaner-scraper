import { useEffect, useMemo, useState } from 'react';
// Tool icons are Hunter x Hunter motifs: each says what the tool does through something from the series
import {
  ArrowLeft, Binoculars, BookmarkSimple, Books, Boat, Butterfly, Cards, CaretRight, CastleTurret, Compass, CurrencyDollar, Database, Detective, Drop, Eye, FishSimple, Flask, Footprints,
  GlobeHemisphereEast, Graph, HandFist, IdentificationBadge, Leaf, Lightning, LinkSimpleHorizontal, MagnifyingGlass, MapTrifold, MaskHappy, Needle, Pulse, Scroll, Spiral, Swap, Wrench,
} from '@phosphor-icons/react';
import { NEN, NenMark, Spider, type NenType } from './components/Emblem';
import { ReportProblem } from './components/ReportProblem';
import { listDatasets, onDatasetsChanged } from '@/lib/db';
import { NavContext, type Handoff, type Nav, type ToolId, type View } from './components/nav';
import { RecipesView, useRecipes } from './components/recipes';
import { MonitorsView, useMonitors } from './components/monitors';
import { PriceTrackerView, useTrackers } from './components/PriceTracker';
import { OPEN_KEY } from '@/lib/monitor';
import { browser } from 'wxt/browser';
import { SitemapExplorer } from './components/tools/SitemapExplorer';
import { DataView } from './components/DataView';
import { ListExtractor } from './components/tools/ListExtractor';
import { PageExtractor } from './components/tools/PageExtractor';
import { ImageDownloader } from './components/tools/ImageDownloader';
import { SiteCrawler } from './components/tools/SiteCrawler';
import { StoreExtractor } from './components/tools/StoreExtractor';
import { PageText } from './components/tools/PageText';
import { VERTICAL_CONFIG, VerticalTool } from './components/tools/VerticalTool';
import { SocialPosts } from './components/tools/SocialPosts';
import { CompanyLookup, EmailChecker } from './components/tools/LeadTools';
import { DomainLookup, TechChecker } from './components/tools/WebsiteTools';
import { DataConverter, LinkExtractor } from './components/tools/DataTools';
import { DocumentTool } from './components/tools/DocumentTool';
import { MarketplaceTool } from './components/tools/MarketplaceTool';
import { VideoDownloader } from './components/tools/VideoDownloader';
import { PageCapture } from './components/tools/PageCapture';
import { SiteCrawl } from './components/tools/SiteCrawl';
import { refreshScraplingReady } from '@/lib/scrapling';

export type ToolGroup = 'ecommerce' | 'industries' | 'leads' | 'any' | 'website' | 'files';

/** Each group is one of the six Nen types: its colour and corner of the Nen chart tell the groups apart. */
export const GROUPS: { id: ToolGroup; name: string; nen: NenType }[] = [
  { id: 'ecommerce', name: 'E-commerce', nen: 'enhancer' },
  { id: 'industries', name: 'Jobs, property, travel and news', nen: 'emitter' },
  { id: 'leads', name: 'Sales leads', nen: 'manipulator' },
  { id: 'any', name: 'Any website', nen: 'transmuter' },
  { id: 'website', name: 'Website and domain', nen: 'conjurer' },
  { id: 'files', name: 'Files and data', nen: 'specialist' },
];

export const TOOLS: { id: ToolId; group: ToolGroup; name: string; blurb: string; output: string; Icon: typeof Eye; keywords?: string }[] = [
  { id: 'shopify', group: 'ecommerce', name: 'Store extractor', blurb: 'Any online store: Amazon, Shopify, WooCommerce or custom. Exports as a Shopify CSV too.', output: 'row per product', Icon: HandFist, keywords: 'shop products price wholesale cafe24 k-beauty korean' },
  { id: 'marketplace', group: 'ecommerce', name: 'Marketplace search', blurb: 'Search Amazon, Walmart, eBay, Etsy, AliExpress or K-beauty shops by keyword, or look up ASINs.', output: 'row per product', Icon: Binoculars, keywords: 'amazon asin walmart ebay etsy alibaba aliexpress target yesstyle olive young stylevana research' },
  { id: 'reviews', group: 'ecommerce', name: 'Review analyzer', blurb: 'Customer reviews with the rating spread, sentiment, and what people praise or complain about.', output: 'row per review', Icon: Eye, keywords: 'amazon reviews ratings sentiment complaints' },
  { id: 'images', group: 'ecommerce', name: 'Image downloader', blurb: 'Pictures sorted by size, named by product or SKU.', output: 'files', Icon: Cards, keywords: 'photos pictures download zip' },
  { id: 'jobs', group: 'industries', name: 'Job listings', blurb: 'Roles, companies, salaries and dates from job boards, or straight from company hiring systems.', output: 'row per job', Icon: IdentificationBadge, keywords: 'indeed glassdoor monster wellfound upwork greenhouse lever ashby careers hiring salary' },
  { id: 'realestate', group: 'industries', name: 'Real estate listings', blurb: 'Prices, beds, baths, area, status and broker from property search and listing pages.', output: 'row per property', Icon: CastleTurret, keywords: 'zillow redfin realtor trulia apartments homes rent sale mls' },
  { id: 'travel', group: 'industries', name: 'Travel and places', blurb: 'Hotels, restaurants, attractions and tours with ratings, prices and amenities.', output: 'row per place', Icon: Boat, keywords: 'tripadvisor priceline trivago marriott viator hotels restaurants' },
  { id: 'articles', group: 'industries', name: 'News and articles', blurb: 'Headlines, authors, dates and text with sentiment, from articles, news pages and RSS feeds.', output: 'row per article', Icon: Scroll, keywords: 'news blog rss feed headlines sentiment content' },
  { id: 'posts', group: 'industries', name: 'Social posts', blurb: 'Public posts from Telegram channels, Reddit and Tumblr or any blog feed.', output: 'row per post', Icon: Butterfly, keywords: 'telegram reddit tumblr social media' },
  { id: 'company', group: 'leads', name: 'Company lookup', blurb: 'A company profile from its website: contacts, address, socials, technology, domain age.', output: 'row per company', Icon: Detective, keywords: 'firmographic enrichment business info domain' },
  { id: 'business', group: 'leads', name: 'Business listings', blurb: 'Names, phones, addresses, websites and ratings from directories like Yellow Pages and Manta.', output: 'row per business', Icon: MapTrifold, keywords: 'yellow pages manta directory local business leads' },
  { id: 'emails', group: 'leads', name: 'Contact extractor', blurb: 'Emails and phone numbers from websites and their contact pages.', output: 'row per site', Icon: FishSimple, keywords: 'email phone number extractor' },
  { id: 'social', group: 'leads', name: 'Social link extractor', blurb: 'X, Instagram, LinkedIn, YouTube, TikTok, WhatsApp, KakaoTalk and more.', output: 'row per site', Icon: Spiral, keywords: 'instagram facebook tiktok youtube whatsapp kakao' },
  { id: 'emailcheck', group: 'leads', name: 'Email checker', blurb: 'Is each address well formed, a throwaway or typo, and can its domain receive mail?', output: 'row per email', Icon: Needle, keywords: 'verify validate bulk email verifier' },
  { id: 'list', group: 'any', name: 'List extractor', blurb: 'Lists, tables, search results and product grids, across pages.', output: 'row per item', Icon: Footprints },
  { id: 'page', group: 'any', name: 'Page extractor', blurb: 'The same fields from many similar pages.', output: 'row per page', Icon: Books },
  { id: 'text', group: 'any', name: 'Page text extractor', blurb: 'Clean readable text and metadata, no menus or ads.', output: 'row per page', Icon: Leaf, keywords: 'text content readability' },
  { id: 'capture', group: 'any', name: 'Page capture', blurb: 'The page as files to reuse: Markdown for AI, structure and buttons, design tokens, one component, quotes, and screenshots you can redact.', output: 'files', Icon: MaskHappy, keywords: 'screenshot full page capture pdf markdown ai design tokens tailwind css component copy quote source evidence exhibit redact blur annotate mhtml pagegrab' },
  { id: 'video', group: 'any', name: 'Video downloader', blurb: 'Saves the videos a page plays, streams included, at the quality you pick. Also audio, subtitles and live broadcasts.', output: 'files', Icon: Lightning, keywords: 'video download mp4 hls m3u8 dash mpd stream twitter x instagram tiktok facebook vimeo reddit audio subtitles live record' },
  { id: 'links', group: 'any', name: 'Link extractor', blurb: 'Every link on a page with its text, sorted into same-site, other sites, emails and files.', output: 'row per link', Icon: LinkSimpleHorizontal, keywords: 'url extractor links' },
  { id: 'sitemap', group: 'any', name: 'Sitemap explorer', blurb: "Every URL in a site's sitemaps, as a tree to filter and pick from.", output: 'row per URL', Icon: Compass, keywords: 'sitemap urls' },
  { id: 'tech', group: 'website', name: 'Technology checker', blurb: 'What a site is built with: store platform, CMS, analytics, pixels, chat, payments, hosting.', output: 'row per site', Icon: Flask, keywords: 'tech stack builtwith wappalyzer cms' },
  { id: 'sitecrawl', group: 'website', name: 'Site crawler', blurb: 'Every page of a website with its title, description, headings and links, crawled by Scrapling. Follows robots.txt; can stop and continue.', output: 'row per page', Icon: Graph, keywords: 'crawl spider scrapling seo audit all pages site map robots' },
  { id: 'domain', group: 'website', name: 'Domain lookup', blurb: 'Registration (WHOIS), DNS and email setup, SSL certificate and subdomains.', output: 'row per domain', Icon: GlobeHemisphereEast, keywords: 'whois rdap dns ssl certificate subdomain finder' },
  { id: 'documents', group: 'files', name: 'PDF and image to data', blurb: 'Text, tables and invoice fields from PDFs, photos and scans, with OCR in English and Korean.', output: 'rows or text', Icon: Drop, keywords: 'ocr pdf to csv image to excel invoice jpg to text table extraction' },
  { id: 'convert', group: 'files', name: 'Data converter', blurb: 'HTML to Markdown, HTML tables to Excel, Excel to JSON, JSON formatter, merge CSV files.', output: 'files', Icon: Swap, keywords: 'html markdown excel json csv merge beautifier' },
];

function Mark() {
  return (
    <div aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent-text shadow-[inset_0_0_0_1px_var(--line)]">
      <Spider size={24} />
    </div>
  );
}

function HomeLink({ onClick, Icon, label, meta }: { onClick: () => void; Icon: typeof Eye; label: string; meta: string | null }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-left text-[13px] transition hover:border-accent/50 hover:bg-surface-2"
    >
      <Icon size={17} weight="duotone" className="shrink-0 text-accent-text" aria-hidden />
      <span className="flex-1 font-medium">{label}</span>
      <span className="font-mono text-[11px] text-muted tabular-nums">{meta}</span>
      <CaretRight size={14} className="text-muted" aria-hidden />
    </button>
  );
}

function Home({ go }: { go: (v: View) => void }) {
  const recipes = useRecipes();
  const monitors = useMonitors();
  const trackers = useTrackers();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return TOOLS;
    return TOOLS.filter((t) => {
      const hay = `${t.name} ${t.blurb} ${t.keywords ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [query]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <HomeLink onClick={() => go({ tab: 'recipes' })} Icon={BookmarkSimple} label="Recipes" meta={recipes && (recipes.length ? `${recipes.length} saved` : 'none yet')} />
        <HomeLink
          onClick={() => go({ tab: 'monitors' })}
          Icon={Pulse}
          label="Monitors"
          meta={monitors && (monitors.length ? [`${monitors.filter((m) => !m.paused).length} active`, ...(monitors.some((m) => m.lastStatus === 'error') ? [`${monitors.filter((m) => m.lastStatus === 'error').length} failing`] : [])].join(', ') : 'none yet')}
        />
        <HomeLink
          onClick={() => go({ tab: 'prices' })}
          Icon={CurrencyDollar}
          label="Price tracking"
          meta={trackers && (trackers.length ? [`${trackers.length} tracked`, ...(trackers.some((t) => t.sources.some((s) => s.violation)) ? [`${trackers.reduce((n, t) => n + t.sources.filter((s) => s.violation).length, 0)} below MAP`] : [])].join(', ') : 'none yet')}
        />
      </div>
      <label className="relative block">
        <span className="sr-only">Find a tool</span>
        <MagnifyingGlass size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a tool: zillow, indeed, ocr, whois..."
          className="min-h-10 w-full rounded-xl border border-line bg-surface py-2 pr-3 pl-9 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </label>
      {GROUPS.map((g) => {
        const tools = shown.filter((t) => t.group === g.id);
        if (!tools.length) return null;
        return (
          <section key={g.id} aria-labelledby={`group-${g.id}`} className="flex flex-col gap-2" style={{ '--nen': `var(--nen-${g.nen})` } as React.CSSProperties}>
            <div className="flex items-center gap-2 px-1">
              <NenMark type={g.nen} />
              <h2 id={`group-${g.id}`} className="font-display text-[14px] text-ink">
                {g.name}
              </h2>
              <span className="ml-auto text-[11px] text-muted" title={`Nen type: ${NEN.find((n) => n.id === g.nen)!.name}`}>
                {NEN.find((n) => n.id === g.nen)!.kanji}
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-2">
              {tools.map(({ id, name, blurb, output, Icon }) => (
                <li key={id}>
                  <button
                    onClick={() => go({ tab: 'tools', tool: id })}
                    className="group flex h-full w-full cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-[color:var(--nen)] hover:bg-surface-2 active:scale-[0.99]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--nen)] [background:color-mix(in_srgb,var(--nen)_14%,transparent)]">
                      <Icon size={19} weight="duotone" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[14.5px] font-semibold tracking-tight">{name}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-muted">{output}</span>
                      </span>
                      <span className="text-[12.5px] leading-snug text-muted">{blurb}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!shown.length && <p className="px-1 text-[13px] text-muted">No tool matches &ldquo;{query}&rdquo;.</p>}
      <p className="px-1 text-[12px] leading-relaxed text-muted">
        Everything runs in your browser, on pages you can already see, including ones you're signed in to. Your data stays on this computer; the domain and email checks only send domain names to public lookup services.
      </p>
    </div>
  );
}

function ToolView({ tool }: { tool: ToolId }) {
  switch (tool) {
    case 'list':
      return <ListExtractor />;
    case 'page':
      return <PageExtractor />;
    case 'images':
      return <ImageDownloader />;
    case 'emails':
      return <SiteCrawler kind="emails" />;
    case 'social':
      return <SiteCrawler kind="social" />;
    case 'shopify':
      return <StoreExtractor />;
    case 'text':
      return <PageText />;
    case 'sitemap':
      return <SitemapExplorer />;
    case 'marketplace':
      return <MarketplaceTool />;
    case 'jobs':
    case 'realestate':
    case 'travel':
    case 'articles':
    case 'reviews':
    case 'business':
      return <VerticalTool config={VERTICAL_CONFIG[tool]} />;
    case 'posts':
      return <SocialPosts />;
    case 'company':
      return <CompanyLookup />;
    case 'emailcheck':
      return <EmailChecker />;
    case 'tech':
      return <TechChecker />;
    case 'domain':
      return <DomainLookup />;
    case 'links':
      return <LinkExtractor />;
    case 'convert':
      return <DataConverter />;
    case 'documents':
      return <DocumentTool />;
    case 'video':
      return <VideoDownloader />;
    case 'capture':
      return <PageCapture />;
    case 'sitecrawl':
      return <SiteCrawl />;
  }
}

export default function App() {
  // A dataset to show straight away: from an alert click (?dataset= when the panel opens as a tab)
  const [view, setView] = useState<View>(() => {
    const q = new URLSearchParams(location.search);
    const id = q.get('dataset');
    if (id) return { tab: 'data', datasetId: id };
    if (q.get('tracker')) return { tab: 'prices', trackerId: q.get('tracker')! };
    return { tab: 'tools' };
  });
  useEffect(() => {
    const take = (v?: { datasetId?: string; trackerId?: string; at: number }) => {
      if (!v || Date.now() - v.at > 120000) return;
      if (v.trackerId) setView({ tab: 'prices', trackerId: v.trackerId });
      else if (v.datasetId) setView({ tab: 'data', datasetId: v.datasetId });
      browser.storage.local.remove(OPEN_KEY);
    };
    browser.storage.local.get(OPEN_KEY).then((r) => take(r[OPEN_KEY] as any));
    const onChange = (c: Record<string, { newValue?: unknown }>, area: string) => area === 'local' && c[OPEN_KEY]?.newValue && take(c[OPEN_KEY].newValue as any);
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);
  // Lists find themselves again with Scrapling when it is installed (checked once a day)
  useEffect(() => void refreshScraplingReady().catch(() => {}), []);
  const [count, setCount] = useState(0);
  // Tools stay mounted once opened, so a running job keeps going while you look at other screens.
  const [opened, setOpened] = useState<ToolId[]>([]);
  useEffect(() => {
    if (view.tab === 'tools' && view.tool && !opened.includes(view.tool)) setOpened((o) => [...o, view.tool!]);
  }, [view, opened]);

  useEffect(() => {
    const load = () => listDatasets().then((l) => setCount(l.length));
    load();
    return onDatasetsChanged(load);
  }, []);

  const [pending, setPending] = useState<Nav['pending']>(null);
  const nav: Nav = useMemo(
    () => ({
      view,
      go: setView,
      openDataset: (id) => setView({ tab: 'data', datasetId: id }),
      handoff: (h: Handoff) => {
        setPending({ ...h, seq: Date.now() + Math.random() });
        setView({ tab: 'tools', tool: h.tool });
      },
      pending,
      consume: (seq) => setPending((p) => (p?.seq === seq ? null : p)),
    }),
    [view, pending],
  );

  const tool = view.tab === 'tools' && view.tool ? TOOLS.find((t) => t.id === view.tool) : undefined;
  const title = tool ? tool.name : view.tab === 'recipes' ? 'Recipes' : view.tab === 'monitors' ? 'Monitors' : view.tab === 'prices' ? 'Price tracking' : 'Gleaner';
  const tabCls = (on: boolean) =>
    `inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] transition ${on ? 'bg-surface-2 text-ink font-medium shadow-[inset_0_0_0_1px_var(--line)]' : 'text-muted hover:text-ink'}`;

  return (
    <NavContext.Provider value={nav}>
      <div className="mx-auto flex min-h-dvh max-w-[960px] flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2.5">
            {tool || view.tab === 'recipes' || view.tab === 'monitors' || view.tab === 'prices' ? (
              <button onClick={() => setView({ tab: 'tools' })} aria-label="Back to tools" className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
                <ArrowLeft size={18} aria-hidden />
              </button>
            ) : (
              <Mark />
            )}
            {tool && (() => { const nen = GROUPS.find((g) => g.id === tool.group)!.nen; return <tool.Icon size={20} weight="duotone" aria-hidden className="shrink-0" style={{ color: `var(--nen-${nen})` }} />; })()}
            <h1 className="line-clamp-2 font-display text-[16px] leading-tight">{title}</h1>
          </div>
          <nav aria-label="Main" className="flex items-center gap-1">
            <ReportProblem compact tool={(view.tab === 'tools' && view.tool) || view.tab} />
            <button className={tabCls(view.tab === 'tools')} aria-current={view.tab === 'tools' ? 'page' : undefined} onClick={() => setView({ tab: 'tools' })}>
              <Wrench size={15} aria-hidden /> Tools
            </button>
            <button className={tabCls(view.tab === 'data')} aria-current={view.tab === 'data' ? 'page' : undefined} onClick={() => setView({ tab: 'data' })}>
              <Database size={15} aria-hidden /> Data
              {count > 0 && <span className="font-mono text-[11px] text-muted tabular-nums">{count}</span>}
            </button>
          </nav>
        </header>
        <main className="flex flex-1 flex-col px-4 py-4">
          {view.tab === 'data' && <DataView datasetId={view.datasetId} />}
          {view.tab === 'tools' && !view.tool && <Home go={setView} />}
          {view.tab === 'recipes' && <RecipesView />}
          {view.tab === 'monitors' && <MonitorsView />}
          {view.tab === 'prices' && <PriceTrackerView />}
          {opened.map((id) => (
            <div key={id} hidden={!(view.tab === 'tools' && view.tool === id)} className="flex flex-1 flex-col">
              <ToolView tool={id} />
            </div>
          ))}
        </main>
      </div>
    </NavContext.Provider>
  );
}
