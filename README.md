# Gleaner

**Get it:** download `Gleaner-Setup-<version>.zip` from this repository's Releases, unzip it, double-click **Install Gleaner** and follow **Gleaner Guide.html**. Windows, Edge or Chrome.

A point-and-click web scraper that lives in your browser's side panel (Chrome, Edge and Brave).
Everything runs locally on pages you can already open, including ones you're signed in to.

**Look.** A Hunter x Hunter theme: Phantom Troupe ink with the scarlet of the Kurta clan's eyes as the one action colour, an original spider emblem whose abdomen is the Nen hexagon, and the six Nen types marking the tool groups (Enhancer for e-commerce, Emitter for jobs, property, travel and news, Manipulator for sales leads, Transmuter for any website, Conjurer for website and domain, Specialist for files and data). Tool icons are motifs from the series: the Jajanken fist, Gyo eye, Greed Island cards, Kurapika's chains, Killua's lightning and more. Titles use Dela Gothic One; text uses Geist. Light and dark follow the system.

**Report a problem.** The bug button in the header (and under any run that stopped or failed) saves one ZIP to Downloads/Gleaner: what you expected, how the run ended, every step it reported, a picture of the page and what Gleaner found on it (product grid, Next button, page numbers, scrolling areas, pop-ups). Nothing is sent; look inside before sharing it.

## Tools

| Tool | What it does |
|---|---|
| List extractor | Finds the repeating list on a page (or you click one item), extracts every row, follows "Next" buttons, "Load more" or infinite scroll. |
| Store extractor | Any online store. Detects Shopify, WooCommerce, Amazon, BigCommerce, Magento and custom stores, then uses the best method: the public product feed, the sitemap, the listing page in your tab (follows Next buttons and numbered pages), or product links. Can open each product page for full details, and can output Shopify's import CSV from any platform. |
| Page extractor | Visits a list of URLs and collects page metadata, product details found automatically (JSON-LD, microdata, Open Graph, Amazon layouts, then page heuristics) and your own CSS-selector fields. |
| Contact extractor | Emails and phone numbers from websites, optionally following contact/about/team pages. |
| Image downloader | Collects images from the current page or many pages, groups them by size, and downloads all of them, one size, or the ones you pick. |
| Page capture | The open page as files to reuse: Markdown for AI, structure and calls to action, design tokens, one component, quotes with their source, a reference pack; and screenshots (visible, whole page, A4 PDF) edited in Capture Studio and saved as records or evidence packs. |
| Video downloader | Saves the videos a page plays: plain files, and HLS/DASH streams at the quality you choose with picture and sound joined into one MP4. Also audio only, subtitles and live HLS recording. |
| Social link extractor | Finds X, Instagram, Facebook, LinkedIn, YouTube, TikTok, Pinterest, Threads, GitHub, Discord and Telegram links. |
| Page text extractor | Clean readable text plus title, author and word count via Mozilla Readability. |
| Sitemap explorer | Reads robots.txt Sitemap lines (or /sitemap.xml), follows sitemap indexes including `.xml.gz`, up to 50,000 URLs. Shows them as a filterable tree with checkboxes; send the picked URLs to the Page extractor or save them as data. |
| Site crawler | Every page of a website with its title, description, h1, language, canonical, word count and links, crawled by [Scrapling](https://github.com/D4Vinci/Scrapling)'s Spider. Same site only, follows robots.txt, a page limit and a click-depth limit, and a stopped crawl can be continued. |

**Recipes** save a List extractor setup (URL pattern, list, columns, pagination) or a Page extractor setup
(fields, toggles, loading, URLs) under a name. The List extractor offers a matching recipe when the open page
fits its URL pattern, and the Recipes screen on the home page renames, deletes and runs them.

**Monitors** re-run a recipe or a Store extractor setup hourly, daily or weekly, in the background with
the side panel closed. Each run is compared with the previous one and the changes are saved to Data as a
change report. A notification fires when a rule matches (any price drop, a price under your target, back
in stock, new items); clicking it opens the report. Everything runs locally, with no account or cloud plan.

Results are saved in the **Data** tab (IndexedDB): search, edit cells, rename or delete columns, remove
duplicates and empty columns, and export CSV, Excel or JSON, or copy for Google Sheets.

Multi-page tools load pages three ways: **Auto** (default) fetches the HTML and switches to a background
tab when a page is built by JavaScript or the site blocks plain requests, **Fast** only fetches HTML, and
**Browser tab** opens every page in a background tab. Temporary failures are retried with backoff. When a
site shows a bot check (CAPTCHA), Gleaner stops instead of retrying, so you can complete it in a normal tab.

In the Data tab you can also **export with pictures** (Excel with embedded images, PDF, or a ZIP with the
CSV and an images folder) and **compare with another run** to get a report of new and removed rows and
price changes.

## Full-page data table

Click **Open full data table** in the Data tab (or **Open full table** on any result) to open a
dataset in its own browser tab:

- Switch datasets from the header, search with Ctrl+F, sort any column (prices and numbers sort
  numerically), resize and hide columns, compact or comfortable rows, light/dark/system theme.
- Each column header shows its type and a thin bar for how much of the column is filled.
- Hover a picture to enlarge it; click a row for a detail panel with all pictures and fields
  (arrow keys move between rows); double-click a cell to edit it (saved automatically).
- **Export** uses the current search, sort and visible columns: CSV, Excel, Excel with pictures,
  PDF, JSON, **Google Sheets** (copies the table with =IMAGE() formulas and opens a new sheet;
  press Ctrl+V), and **Copy to clipboard** for Excel/Sheets, a formatted table for Docs, Notion
  or email, Markdown, JSON or CSV text.
- Only the rows on screen are drawn, so tens of thousands of rows stay smooth.

## Guardrails, wholesale data and column planning

- **Every product on every page.** On each page the Store extractor first scrolls (and presses "Show more") until no new products arrive, and only then moves to the next page, by its Next button, the next page number, or the page number in the address. If the product grid moves on later pages (a banner above it), it is found again; one page with nothing new is checked again on the next page before the run ends.
- **One row per variant.** Each colour, size or scent gets its own row with its price, compare-at price, SKU, stock, barcode and picture, from the Shopify feed or theme data, WooCommerce variations or schema.org product groups (for listing pages, turn on "Also open each product page").
- **New since the last run.** Keep all, mark new (a "new since last run" column), or keep only new products. The Review analyzer and the other industry tools have the same choice; with reviews sorted newest first, a re-run stops as soon as it reaches the reviews you already have.
- **Paced paging that never skips.** The Store extractor's "This page" method waits a random
  1.5 to 3 s between pages (Gentle, Normal or Fast) with a short break every few pages. Every page is
  health-checked before it is read; an error page (404, 500, "Oops", bot check) is retried with
  growing waits (5, 15, 40 s) by jumping straight back to that page number (URL, the site's pager
  form, or Back then Next), and the rest of the run slows down. If a page keeps failing the run
  stops, saves what it has and says which page to enter in **Start from page** to continue.
- **Details read from cards and product pages:** "Label: value" pairs (SKU, PartNum, Bar Code,
  Stock, MOQ, 1Box, 1Carton...), stock quantity and status, and every price currency in its own
  column (for example price (KRW) and price (USD)). Unknown labels that appear on at least 30% of
  products become their own columns.
- **Wholesale mode** (auto/on/off) adds "1 box = 48 ea", "1 carton = 240 ea" and box price.
- **Analyze first** samples the page (and one product page) and lists every column it can create,
  with fill rate and a sample value, so you choose the exact columns before scraping. Each run ends
  with a quality note listing columns that came back mostly empty.
- **URL ranges** in any URL box: `.../page/[1-40]`, `[001-100]`, `?offset=[0-200:20]`.
- **Clean data** in the full table: trim, keep the number, find and replace, extract with a pattern,
  change case, add text, or split a column, with a preview, into the same or a new column.

## Image downloader: sizes and product names

- **Three sources**: this page, a list of pages, or saved data from a Store or List run (uses its title, SKU and brand columns).
- **Measured, not guessed**: every picture is downloaded once to read its real pixels and file size. Identical pictures under different URLs are merged.
- **Grouped by size** (the default view): Extra large, Large, Medium and Small each get their own section with a count, total file size, "Select all/none" and "Download N Small" (or Medium, Large...), which saves just that size into its own folder. "Download all" saves every size. "All together" switches back to one grid.
- **Size classes** by the longest side: Small under 500 px, Medium 500 to 999, Large 1000 to 1999, Extra large 2000 and up (file size decides when pixels are unknown). Filter chips show counts; "Put each size in its own folder" saves into Small/, Medium/, Large/, Extra large/.
- **Full-size versions**: resized links from Shopify, WordPress, Amazon, Wix, Squarespace and Cafe24 are swapped for the original when it loads, and thumbnails that link to their big picture (or name it in a zoom attribute) are swapped for it.
- **Open small pictures to get the big ones** (This page): each thumbnail is clicked the way a person would, and the bigger picture it shows (a gallery's main picture, a zoom or lightbox) is kept instead. Pop-ups are closed afterwards, links to other pages are never followed, and it adds up to a minute.
- **File names** from the product: product name, SKU, SKU + name, brand + name, alt text, original name, numbers, or a custom pattern with `{name} {sku} {brand} {part} {size} {w} {h} {alt} {original} {n}`. Pictures are linked to products through product cards and the product page's gallery (related-product and header pictures are left out). Several pictures of one product get -1, -2, -3.
- **Format**: keep original, or convert to JPG, PNG or WebP.
- **Every variant's pictures** (This page): each colour, size or scent's picture, from the shop's own data (Shopify, WooCommerce, schema.org) or, when there is none, by choosing each option in turn and keeping the picture it shows. Pictures are named Product name + variant by default; the `{variant}` token works in custom names.
- **One ZIP** option with a `pictures.csv` listing file, product, SKU, size, pixels and source.

## Price tracking and MAP monitoring

Watch one product's price across competitors' stores, and catch sellers advertising below your MAP.

- **Track a product** by its name, SKU, barcode (GTIN) or part number, with your price and, optionally, a MAP. "Use this page" fills these from the open product page.
- **Competitor pages**: paste one product-page URL per store. Each run opens them (three at a time), confirms it's the same item (barcode, then SKU, then part number, then title; see `lib/match.ts`), and records the price and stock.
- **Matching you can see**: each store shows how it matched (barcode, SKU, part number, or title with a %). Title matches never cross sizes, so a 300ml listing is not your 150ml product. For a title match or no match, "It's this product" / "Not this product" settles it, and the choice sticks for every later check.
- **Currencies**: your price and MAP are in one currency (USD, KRW...). A page showing several (₩12,000 / $9.10) is read in yours. A page priced only in another currency is shown but never compared, so ₩9,500 is not mistaken for "below a $12 MAP".
- **Alerts** on a price drop, a price under your own, a MAP violation, or a restock. Desktop notification; clicking it opens the tracker.
- **History**: every run appends a price/stock point, shown as a small line per store. The newest 365 readings are kept for each store.
- **MAP evidence**: when a page is found below MAP, Gleaner saves a screenshot you can open as proof.
- **Schedule**: hourly, daily or weekly, in the background while the browser is open. "Check now" runs it on demand.
- **Limit**: as a browser extension, scheduled checks only run while the browser is open. Missed checks run when it starts again. Round-the-clock monitoring would need a server.

## Bot checks (no bypass)

Gleaner does not defeat CAPTCHAs, Cloudflare, or other bot checks. When a listing run hits one:

- **You're watching**: Gleaner brings the page to the front, notifies you, and waits while you solve the check in the tab, then carries on from the same page.
- **A scheduled run**: it stops cleanly with a clear message, since no one is there to solve it.
- It already paces itself and retries real errors, so most runs never trigger a check.

## Industry, lead, website and file tools

The home screen groups 25 tools into E-commerce, Jobs/property/travel/news, Sales leads, Any website,
Website and domain, and Files and data, with a search box ("zillow", "indeed", "ocr", "whois"...).

**How the industry tools read sites.** Most sites describe their listings twice: for search engines
(schema.org JobPosting, Residence, Hotel, LocalBusiness, NewsArticle, Review) and for their own app
(JSON embedded in the page, like Next.js data). Gleaner reads those first and falls back to the visible
cards. One engine (`lib/verticals/`) therefore works across many sites and survives redesigns, instead of
one fragile scraper per site. Search pages are walked page by page with the same pacing, page checks
and bot-check pause as the Store extractor.

| Tool | Reads | Sources |
|---|---|---|
| Job listings | title, company, location, workplace, type, salary range and period, posted/closing dates, description | job boards (Indeed, Glassdoor, Monster, Wellfound...), and companies' own hiring systems: Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Workable (their public job feeds) |
| Real estate listings | address, price, status, beds, baths, area, price per area, lot, year built, days on market, broker, coordinates; on a listing page also all photos, floor plans, the 3D tour link, stated room sizes and the description | Zillow, Redfin, Realtor.com, Trulia, Apartments.com and other portals |
| Travel and places | name, type, rating, reviews, stars, price, address, cuisine, amenities, hours | Tripadvisor, Viator, Priceline, Trivago, hotel chains |
| News and articles | headline, author, dates, publisher, section, tags, text, word count, keywords, sentiment | articles, section pages (finds the articles), RSS/Atom feeds (found from a homepage) |
| Social posts | text, date, views or score, comments, media, sentiment | public Telegram channels, Reddit communities/searches/threads, Tumblr and blog feeds |
| Review analyzer | rating, title, text, date, verified, helpful, the reviewer's photos (full size), review id; rating spread, sentiment, praise and complaints | Amazon, Google reviews (star icons, the scrolling review panel), and any site that marks up its reviews. Follows Next pages, clicks "Show 10 more reviews"-style buttons, scrolls panels that load more, and opens "More" on long reviews without following links |
| Business listings | name, category, phone, email, website, address, rating, hours, years in business | Yellow Pages, Manta and other directories |
| Company lookup | name, description, published emails and phones, address, socials, technology, email provider, domain age | the company's own website and public records |
| Email checker | format, typo suggestion, throwaway, role address, free provider, mail server | DNS (no email is sent) |
| Marketplace search | product cards from search results, or products by ASIN | Amazon (5 countries), Walmart, eBay, Etsy, Target, AliExpress, Alibaba, YesStyle, Olive Young, Stylevana. Opens the search in a tab and reads page after page: Next buttons, page numbers, "Load more" buttons or infinite scroll |
| Technology checker | store platform, CMS, frameworks, analytics, pixels, chat, payments, reviews, hosting, CDN, server (with the evidence) | page code and response headers |
| Domain lookup | registrar, dates, status, nameservers, DNS, mail provider, SPF, DMARC, SSL issuer and expiry, subdomains | RDAP (WHOIS), Cloudflare DNS, crt.sh certificate logs |
| Link extractor | every link with its text, sorted into same-site, other sites, email, phone, files | any page |
| PDF and image to data | text, tables, invoice fields; OCR in English and Korean | PDFs (exact text), photos, scans and screenshots. Runs offline inside the extension |
| Data converter | HTML to Markdown, HTML tables to rows, Excel/CSV to JSON, JSON formatter with error locations, CSV/Excel merge | pasted HTML, a page, or files |

**Google reviews.** Open the place's reviews (the review window in Google Search, or the Reviews tab in Google Maps) and run the Review analyzer: it reads all of them, 10 at a time, by scrolling the review window (stepping back a little when the list sits at its end, since Google only loads more when the list moves), and never follows the search page's own "Next" behind it. Google only loads more when a person scrolls, so Gleaner scrolls with a real mouse wheel through the browser's debugging interface; Edge or Chrome shows a "Gleaner started debugging this browser" bar during the run, which closes when it ends (closing it early just stops the scrolling). Star-only reviews are kept, reviewer names are left out, and each review's photos come as full-size links (download them all with the Image downloader > Saved data). Scrolling loads don't count toward the page limit; the item limit (2,000 by default) does. Google Maps shows only about 5 reviews when you aren't signed in to Google; Gleaner then says so. Sign in, or use the review window in Google Search.

**Lists without a next page.** When there is no Next link or page number, the industry tools, the Store
extractor's listing method and Marketplace search click a "Load more / Show more / See more reviews"
button, or scroll the page (and any scrolling panel inside it) until nothing new appears.

**Options shared by the industry tools:** open each result's own page for full details, keep only items
not seen in earlier runs of the same search, and filters (jobs: keyword, workplace, posted within, minimum
salary; news: keyword, date, minimum words).

**Protected shop pictures.** Some shops (many Korean ones) only serve their pictures to their own pages.
When a direct download is refused, the Image downloader loads the picture through the open tab, the way the
page itself does. Cafe24/Imweb-style lazy pictures (`ec-data-src`, `data-original`...) are read too.

## Property viewer

On a Real estate dataset, **Open property viewer** shows one listing at a time:

- **Key facts and a map pin**: price, status, type, beds, baths, area, price per area, lot, year built;
  an OpenStreetMap pin from the listing's coordinates (or an address search when it has none).
- **The real floor plan and 3D tour** when the listing has them (Matterport and similar open in place or
  in a new tab). Nothing is drawn when a listing has no plan.
- **Photos by room**: "Label photos" sorts the pictures into kitchen, bathroom, bedroom, living room,
  exterior, pool, floor plan and more with CLIP running on your computer (ONNX Runtime WebAssembly). The
  model (about 88 MB) downloads from Hugging Face the first time and is cached; photos are never uploaded.
  About 8 in 10 photos are labeled right on test photos; anything wrong is fixed with the room picker under
  the photo, and your choice is kept with the data. Unsure labels are marked.
- **Room sizes to scale, layout not shown**: the room sizes the listing states ("Kitchen 4.20m x 3.10m",
  "Primary Bedroom 15' 2\" x 12'") drawn as boxes on a 1 m grid, side by side to compare sizes, with a
  metres/feet switch and a table of what the listing wrote. Gleaner never guesses sizes or where rooms are.
- **Feature tags** (pool, garage, balcony, view, fireplace...) from the listing's words and the labeled photos,
  each saying where it came from.

## Page capture and Capture Studio

**Use this page for**
- **Text and pictures for AI**: the article or page as clean Markdown (X posts with their replies too), the
  pictures downloaded into `images/` and linked from the Markdown; the Markdown is also copied.
- **Page structure and calls to action**: the section order (header, hero, features, pricing, FAQ...),
  the heading outline, every button and link with its label, kind (primary, secondary, text link),
  where it is, how often it repeats and where it goes, forms, link counts, and things worth fixing (no
  meta description, skipped heading levels, the main button below the first screen). The buttons are
  also saved to Data.
- **Design specification**: colours by role (background, text, primary, accent, border) and the whole
  palette by use, the type scale, the spacing unit and scale, corner radii, shadows, gradients, content
  widths, breakpoints and the page's own CSS variables, as `tokens.css`, W3C design tokens JSON, a
  Tailwind theme and a readable summary.
- **One component**: point at a button, card or section (↑ and ↓ make the box bigger or smaller) and
  save it as a standalone HTML file with only the styles that make it look that way, plus a preview
  picture and its details.
- **Selected text with its source**: the exact words, the sentences around them, the section heading,
  page, author, date and a link that scrolls straight to the words (`#:~:text=`). Copied, saved as
  Markdown, and collected in a Quotes dataset.
- **Reference pack for AI**: one ZIP with START-HERE.md (what to read first), the page text, and what you
  tick: structure, design spec, pictures, a whole-page picture, with SHA-256 fingerprints.

**Capture the page**: the visible area, the whole page, or the whole page as an A4 PDF. Whole pages are
scrolled through first (waiting for each part to settle, up to a minute, with "Save what has loaded"),
so lazy pictures and lists that grow as you scroll are included; apps that scroll an inner panel are
opened out; pages too tall for one picture are split with a 160 px overlap. An MHTML copy of the page
can be kept for the record. The 10 newest captures from the last week stay on this computer.

Some sites don't let extensions use the browser's debugging interface (the browser says "Host access is restricted by policy"). There Gleaner takes the whole page screen by screen instead: it scrolls through, takes an ordinary screenshot of each screen, and joins them, hiding fixed bars after the first screen so they appear once. The MHTML copy then comes from the browser's own "save page".

**Capture Studio** opens each capture: crop, solid black-out (the safe way to hide secrets), pixelate,
three strengths of blur, highlight, boxes, arrows and text that stays editable, with undo/redo and
keyboard shortcuts. Save as:
- a **PNG** (with the address and capture time added under it, if you like),
- an **A4 PDF** whose page breaks fall on blank rows between lines, with the address, time and page
  numbers on each page,
- a **record ZIP**: the untouched original kept apart from the edited copy, the edit history, a capture
  report (Markdown and JSON: address, time with time zone, window, how the page was loaded and whether
  the end was reached), the MHTML, and SHA-256 fingerprints of every file (`sha256sum -c`),
- an **evidence pack**: the exhibit label ("Exhibit 1", 甲第1号証, 乙第1号証...) in red on every PDF page,
  a draft evidence list (CSV for Excel and JSON), and the fingerprint to send to a timestamp authority.
  A *preservation* pack keeps the original and page copy; a *submission* pack has only the edited copy.
- Optional **trusted timestamp** (RFC 3161) from freetsa.org: only the PDF's fingerprint is sent, and the
  signed `.tsr` with how to check it goes into the ZIP.

**Finish a PDF you have**: open an existing PDF (not password-protected) and its pages are drawn at
200 dpi into Capture Studio, where black-out, notes and the other tools work as for a capture (crop is
left out so each page keeps its size). **Save PDF** gives one page per original page, each at its
original size, with page numbers ("1 / 3") at the bottom; evidence packs also put the exhibit label top
right on every page. There is no address or capture-time line. The finished PDF is made of page pictures,
so blacked-out text is truly gone (and the text can no longer be selected). Evidence packs put it at the
top of the ZIP under its filing name, e.g. `甲第1号証 契約概要.pdf`, or `（マスキング）甲第1号証 契約概要.pdf`
when you tick the masked-copy box. The preservation pack keeps the PDF exactly as opened
(`original/source.pdf`), and the report says the source was a PDF, with its SHA-256 and page sizes.

**Check before filing (mints)**: a mechanical check of the finished PDF against the file rules written in
the mints manual for parties (操作マニュアル～当事者ユーザ編～ 2.2版), listed as pass, fail, check or note in
plain words, with the page of the manual each rule comes from:
- no password or encryption (p.65, message 45),
- every page A4 or A3, mixed allowed; other pages are named with their size in mm (p.66, message 46),
- at most 200 MB per upload, with a warning above 150 MB (p.65–66),
- a file name of at most 100 characters including `.pdf` (p.6, p.65, message 53), and characters that
  often fail (outside JIS X 0213, emoji, `\ / : * ? " < > |`) (p.6),
- the （マスキング） name for blacked-out copies filed with a request to restrict access (courts.go.jp,
  "mintsの利用に関する注意点２"),
- and, as general advice rather than a written rule, scripts or files attached inside the PDF.

Evidence packs include the results as `check-before-filing.md` and `check-before-filing.json`. The check
is advice only: passing it does not mean the court will accept the file. Sources:
[courts.go.jp mints page](https://www.courts.go.jp/ip/tetuduki/mints/index.html),
[mintsの利用に関する注意点](https://www.courts.go.jp/assets/mints_oshirase3.pdf).

**EN / 日本語**: the switch at the top of Page capture and in the Studio header changes both to Japanese
(and the exhibit number default to 甲第1号証). The choice is remembered. The rest of Gleaner stays English.

Gleaner does not judge whether an evidence pack meets a court's rules, and sends nothing anywhere except
the optional timestamp fingerprint.

## Scrapling engine

Gleaner uses [Scrapling](https://github.com/D4Vinci/Scrapling) (BSD-3) for two things, run by Gleaner's helper in its own Python environment, `%LOCALAPPDATA%\Gleaner\scrapling`:

- **Site crawler** (new tool): Scrapling's Spider crawls a whole site from a start page. It stays on the site, follows robots.txt (the run says how many pages it left out), waits between pages, and stops at the page and click-depth limits. **Stop** pauses the crawl at a checkpoint; tick "Continue the last crawl of this site" to carry on where it stopped, without visiting a page twice.
- **Self-healing lists**: while a List extractor list, recipe or monitor works, Scrapling remembers what its items look like. When the shop changes its layout (renamed classes, a new wrapper), Scrapling's adaptive matching finds the same items again; the run says so and the recipe is updated with the new selector. A full redesign is beyond it: then pick the list again.

Honest by design: pages are requested with your browser's own User-Agent, with no TLS impersonation, generated headers, fake referer, stealth browser, proxy rotation or Cloudflare/CAPTCHA solving, and a site that pushes back is not retried. Sites with bot checks are read in your own browser tabs, where you can solve a check yourself.

Setting up: the installer does it (Python, then Scrapling). Otherwise the Site crawler offers **Install Scrapling** (about 100 MB, a few minutes). The engine listens on 127.0.0.1 only and answers only requests that carry the token it gives Gleaner when it starts.

## Video downloader

- **Finds videos two ways**: what the page names (video tags, share tags, structured data, video links,
  subtitle tracks) and what the page downloads while it plays (streaming playlists and video files), so
  players that stream through `blob:` addresses (X, Reddit, news sites, course platforms...) are found too.
  Each stream is listed once, with its qualities.
- **Streams**: HLS (transport-stream or MP4 pieces, byte ranges) and DASH (templates, timelines, segment
  lists, single files). Pick a quality; picture and sound are downloaded several pieces at a time and joined
  into one MP4 without re-encoding (`lib/video/mp4.ts`), with the real length written in so it seeks properly.
- **Also**: audio only (.m4a, each language), subtitles (.vtt), plain video and audio files, and live HLS
  broadcasts recorded until you press "Stop and save".
- **Two ways in**: "This page" scans the open tab; "Paste a link" takes any address: a YouTube link, a
  page on one of the 1,000+ sites yt-dlp supports (Vimeo, X, TikTok, Instagram, Facebook, Reddit,
  Dailymotion, Internet Archive...), or a direct .mp4, .m3u8 or .mpd address. "Try this page with yt-dlp"
  hands the open page to yt-dlp when a player hides its video. Sites that show videos only to signed-in
  visitors (Vimeo now does) still work through "This page" while you're signed in, not through yt-dlp.
- **YouTube** (watch pages, Shorts, music.youtube.com, and YouTube players embedded in other sites) is
  saved by [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your computer, through a small helper (see
  below): every quality up to 4K, preferring H.264 + AAC so files play everywhere, MP3 or M4A sound, and
  subtitles (.srt, including YouTube's automatic captions). Files go to your Downloads folder.
  YouTube's terms only allow its own download features, so this is for personal use.
- **Not saved, by design**: any video with DRM or encryption (Netflix, Disney+, Spotify, most paid
  courses, YouTube movies). Gleaner says why instead of trying. Save only videos you have the right to keep.
- **Limits**: the file is put together in the browser, so keep the panel open until it's saved; very long
  high-quality videos need free memory to match. Sites that send picture and sound as two separate
  non-streaming files can only be saved one at a time.

### YouTube helper (one-time setup, Windows)

1. Install yt-dlp and ffmpeg (ffmpeg joins YouTube's separate picture and sound above 360p):
   `winget install yt-dlp.yt-dlp` and `winget install Gyan.FFmpeg`. Node.js is needed too.
2. In the folder you loaded Gleaner from, open `helper` and double-click `install.cmd`. It copies the
   helper to `%LOCALAPPDATA%\Gleaner\helper` and tells Chrome and Edge (for your Windows account only)
   that Gleaner may start it. It works out Gleaner's extension ID from its folder; if Gleaner was loaded
   from somewhere else, run `install.cmd <code>` with the code the Video downloader shows. Run it again
   after moving the Gleaner folder. `uninstall.cmd` removes it.
3. When YouTube changes and saving stops working, update yt-dlp: `winget upgrade yt-dlp.yt-dlp`.

The helper updates itself: when a newer Gleaner ships a newer helper, the panel replaces the installed
one the next time it connects (no need to run install.cmd again).

The helper (`public/helper/gleaner-host.mjs`) only runs yt-dlp with fixed options on web addresses,
saves into Downloads, and can only be started by Gleaner. Keep the side panel open while it saves.

**Deliberately not included:**
- People-search and personal data: Spokeo, White Pages, Lusha, LinkedIn profiles and employees, "decision
  maker" lookups. These compile personal information about individuals. Lead tools collect business details
  only (company emails and phones a business publishes).
- Getting past bot checks, CAPTCHAs, paywalls or logins (see Bot checks above).
- Website traffic estimates and Amazon sales estimates: there is no public source, so any number would be
  made up.
- Mailbox-level email verification: only the receiving mail server knows if a mailbox exists; checking it
  means connecting to that server, which a browser extension cannot do.
- Quora (needs a login to read) and Twitch (needs an account key).
- DRM-protected or encrypted video (see Video downloader).

## Share it: one installer (Windows)

`npm run package` builds Gleaner and saves `release/Gleaner-Setup-<version>.zip`. Share that ZIP (Google Drive, or a GitHub release). Inside: **Install Gleaner**, **Uninstall Gleaner**, **Gleaner Guide.html** (the illustrated guide), READ ME.txt and the extension. The person unzips it and double-clicks **Install Gleaner**, which:

1. puts Gleaner in `%LOCALAPPDATA%\Gleaner\extension` (one fixed place, so later updates and the YouTube helper keep working),
2. installs Node.js, Python, yt-dlp and ffmpeg with winget, if missing (it asks first),
3. installs Scrapling into its own Python environment for the Site crawler and self-healing lists,
4. sets up Gleaner's helper for that folder,
5. opens Edge's or Chrome's extensions page with the folder copied, and shows the last clicks: Developer mode on, **Load unpacked**, paste the folder (Ctrl+V in the folder window's address bar), **Select Folder**.

Browsers only let a person add an extension that doesn't come from a web store, so that last step stays a click; everything else is done by the installer. To update, run the newer installer and click **Reload** on Gleaner. **Uninstall Gleaner** stops Gleaner's helper, removes its files, the helper's browser registration, the Scrapling environment and its crawl data, then opens the extensions page to click **Remove** (Node.js, Python, yt-dlp and ffmpeg stay). The installer's sources are in `installer/`.

## Install (development)

```bash
npm install
npm run build
```

Then open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, click
**Load unpacked** and choose `.output/chrome-mv3`. Click the toolbar icon to open the side panel.
The first time you run a tool it asks for permission to read websites.

`npm run dev` starts a live-reloading browser with the extension loaded. `npm run zip` makes a
store-ready zip in `.output/`.

## How it works

- `entrypoints/background.ts` opens the side panel when the toolbar icon is clicked, and drives monitors
  with `chrome.alarms` and `chrome.notifications`.
- `entrypoints/offscreen/` is a hidden page that runs monitors (the service worker has no DOM). Its tab
  work (background tabs, `/injected.js` commands) is relayed through the worker by `lib/tab.ts`.
- `lib/jobs.ts` holds the List, Page and Store run logic shared by the panel and monitors;
  `lib/monitor.ts` and `lib/monitorRun.ts` store, schedule, run and compare monitors.
- `entrypoints/injected.ts` is injected into a tab only when a tool needs it, and exposes commands
  (`findList`, `extractItems`, `findNext`, `pickList`, ...) that the panel calls via `chrome.scripting`.
- `lib/dom/list.ts` detects lists: every element with 3+ visible children of the same tag, filtered
  by shared class, link pattern or structure, scored by item count, area, fields and visibility.
- `lib/dom/doc.ts` holds extractors that work on any document, so the same code runs on a live tab
  or on fetched HTML.
- `lib/runner.ts` runs multi-URL jobs with a small worker pool.

## Testing

```bash
npm run check     # type check + unit tests
npm test          # unit tests only (vitest, a few seconds)
npm run e2e       # end-to-end tests in Microsoft Edge (several minutes)
npm run e2e -- price images   # only some suites
GLEANER_LIVE=1 npx vitest run tests/video.live.test.ts   # save real test streams, check them with ffprobe
GLEANER_LIVE=1 npx vitest run tests/capture.live.test.ts # a real trusted timestamp from freetsa.org
```

- **Unit tests** (`tests/`) cover the logic that decides things: product matching and sizes, prices and
  currencies, MAP and drop alerts, history limits, image sizes and file names, URL ranges and paging,
  data clean-up, and reading "Label: value" details.
- **End-to-end tests** (`e2e/`) build a test version of Gleaner (`GLEANER_E2E=1`, which grants site access
  up front since tests can't click the permission prompt) and drive the real panel in Edge against local
  test stores: price tracking with MAP evidence, KRW/USD stores, size mismatches and the reject button;
  a crawl that pauses on a bot check and resumes; a 45-page store with failing pages and a resume; the image
  downloader; the 30,000-row data table; reviews that load by scrolling or a "Show more" button and a shop
  grid that grows as you scroll; the Property viewer with real on-device photo labeling; and the Video
  downloader saving public test streams (Mux, Apple, Shaka) that are then checked with ffprobe and played
  back in Edge; and Page capture (every export opened and checked, a page that grows as it scrolls, an
  inner-panel app, Capture Studio edits checked pixel by pixel, PDFs, records and evidence packs, an opened PDF finished
  and checked before filing, and the EN / 日本語 switch). Each check prints ok or FAIL, and the run exits non-zero on
  any failure. Suites that need the internet (a live Shopify page, sample pictures) are skipped when offline.
