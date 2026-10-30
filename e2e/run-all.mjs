// Runs the Edge end-to-end tests against a test build of Gleaner and checks their results.
//   npm run e2e                 all suites
//   npm run e2e -- price images only these
// Needs Microsoft Edge installed. Suites marked "network" also need internet access.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const ext = path.join(root, '.output', 'chrome-mv3-e2e');
const shots = path.join(here, 'shots');
fs.mkdirSync(shots, { recursive: true });

const has = (v) => v !== undefined && v !== null && v !== '';

// Each check is [what it proves, test(result)]. Missing network-only results are skipped, not failed.
const SUITES = {
  price: {
    file: 'price-test.mjs',
    about: 'Price tracking, MAP evidence, currency, matching, bot-check pause',
    checks: [
      ['tracker saves without a form error', (r) => r.formError === ''],
      ['same-product stores match by SKU', (r) => ['store-a', 'store-b', 'store-c'].every((u) => r.firstRun.sources.find((s) => s.url === u)?.by === 'sku')],
      ['below-MAP store is flagged with a screenshot', (r) => r.firstRun.sources.find((s) => s.url === 'store-b')?.violation === true && r.shotOk?.isJpeg === true],
      ['KRW-only store is read but never compared with a USD MAP', (r) => { const c = r.firstRun.sources.find((s) => s.url === 'store-c'); return c.price === 9500 && c.cur === 'KRW' && c.comparable === false && !c.violation; }],
      ['300ml store does not match the 150ml product', (r) => r.firstRun.sources.find((s) => s.url === 'store-d')?.matched === false],
      ['first alert counts only comparable stores', (r) => /^1 below MAP, 2 under your price/.test(r.firstRun.lastAlert ?? '')],
      ['second check sees the drop, the new violation and the restock', (r) => /2 below MAP/.test(r.secondRun.lastAlert) && /1 price drop/.test(r.secondRun.lastAlert) && /1 back in stock/.test(r.secondRun.lastAlert)],
      ['history grows with each check', (r) => r.secondRun.history > r.firstRun.history],
      ['"Not this product" marks the page as rejected', (r) => r.rejected?.some((x) => x.url === 'store-d' && x.decision === 'rejected')],
      ['crawl pauses on a bot check and asks for a human', (r) => r.sawBotPause === true],
      ['crawl resumes after the check and finishes all 6 pages', (r) => r.resumed?.rows === 120],
    ],
  },
  images: {
    file: 'images-test.mjs',
    about: 'Image downloader: sizes, product and SKU names, ZIP, saved data',
    checks: [
      ['20 cards sorted into 5 per size', (r) => r.listing.chips.join('|') === 'All 20|Small 5|Medium 5|Large 5|Extra large 5'],
      ['names use SKU and product name', (r) => r.listing.preview.startsWith('SKU10000-A_[ANUA]_Heartleaf')],
      ['ZIP holds size folders and a list', (r) => r.zipEntries.at(-1) === '... 11 entries' && r.zipEntries.some((e) => e.startsWith('Extra large/'))],
      ['product-page gallery named by SKU, related item not', (r) => r.detailNames.includes('images-localhost/Extra large/SKU10001-A-Extra_large.png') && r.detailNames.includes('images-localhost/Small/other.png')],
      ['saved data: all 24 pictures downloaded', (r) => r.savedCount === 24],
      ['network: Shopify full-size upgrade', (r) => (has(r.shopify) ? /upgraded to full size/.test(r.shopify.note) : 'skip')],
    ],
  },
  wholesale: {
    file: 'wholesale-test.mjs',
    about: '45-page store: guardrail, recovery, resume, wholesale columns',
    checks: [
      ['all 900 products, each once', (r) => r.full.rows === 900 && r.full.uniqueSkus === 900 && r.full.missingCount === 0],
      ['error pages were recovered', (r) => /error pages? recovered/.test(r.full.note)],
      ['KRW, USD, stock, part number and box columns found', (r) => ['price (KRW)', 'price (USD)', 'stock qty', 'part number', 'qty per box'].every((c) => r.full.columns.some((x) => x.toLowerCase() === c.toLowerCase()))],
      ['a failing page stops the run with a resume hint', (r) => r.stopped.rows > 0 && /Start from page/.test(r.stopped.note)],
      ['resuming fills in the rest', (r) => r.resumed.combinedUnique === 900],
    ],
  },
  industry: {
    file: 'industry-test.mjs',
    about: 'Industry, lead, website, data and document tools (live checks need internet)',
    checks: [
      ['home is grouped and searchable', (r) => r.home.groups.length === 6 && r.home.zillow.join() === 'Real estate listings'],
      ['jobs: all 30 across the board’s pages, with salary and workplace', (r) => r.jobs.rows === 30 && r.jobs.sample[0].salary_period === 'hour' && r.jobs.sample[1].workplace === 'remote'],
      ['jobs: job pages add descriptions; keyword filter keeps 6', (r) => r.jobsDetail.rows === 6 && /Full description/.test(r.jobsDetail.description) && r.jobsDetail.valid_through === '2026-12-31'],
      ['real estate: 16 homes over 2 pages, year built from listing pages', (r) => r.realestate.rows === 16 && r.realestate.sample[0].year_built === '2010' && r.realestate.sample[0].price_per_area === '273'],
      ['travel: 4 hotels with ratings and stars', (r) => r.travel.rows === 4 && r.travel.sample[0].stars === '5'],
      ['business: 6 directory cards with phones and websites', (r) => r.business.rows === 6 && /555-0110/.test(r.business.sample[0].phone) && /aceplumbing/.test(r.business.sample[0].website)],
      ['news: 4 articles, navigation skipped, sentiment scored', (r) => r.newsSections.rows === 4 && r.newsSections.sentiment.includes('negative')],
      ['news feed: found from the site, date filter, full text', (r) => r.newsFeed.rows === 3 && r.newsFeed.hasText],
      ['reviews: 6 over 2 pages, summary, no reviewer names', (r) => r.reviews.rows === 6 && r.reviews.hasNames === false && /Complaints:/.test(r.reviews.summary)],
      ['reviews in a scrolling panel: all 30 read, star icons rated, "More" opened, links not followed', (r) => r.reviewsScroll.rows === 30 && r.reviewsScroll.ratings.length >= 4 && r.reviewsScroll.expanded >= 6 && !r.reviewsScroll.ownerReplyAsReview && !r.reviewsScroll.followedLink],
      ['Google-style review window (loads only on a real mouse wheel): all 45, page behind not paged', (r) => r.reviewsWheel.rows === 45 && r.reviewsWheel.ids === 45 && r.reviewsWheel.stayed],
      ['Google review window that loads only when the list moves, with empty replies: all 60, "More" opened', (r) => r.reviewsGoogle.rows === 60 && r.reviewsGoogle.ids === 60 && r.reviewsGoogle.expanded >= 50 && r.reviewsGoogle.stayed],
      ['one row per variant from Shopify, WooCommerce and schema.org data: price, SKU, stock and picture each', (r) => r.storeVariants.rows.length === 7 && r.storeVariants.rows.includes('Heartleaf Toner|250ml|HT-250|32.00|yes|/img/b-600.png') && r.storeVariants.rows.includes('Heartleaf Toner|500ml|HT-500|54.00|no|/img/c-600.png') && r.storeVariants.rows.includes('Glow Cushion|23-natural|GC-23|25|yes|/img/e-600.png') && r.storeVariants.rows.includes('Velvet Lip Tint|Velvet Lip Tint Coral|LT-CO|13.00|yes|/img/a-500.png') && !r.storeVariants.columns.includes('_variants')],
      ['report a problem: ZIP with the run, the steps, the page and a picture', (r) => ['activity.log', 'page.png', 'report.json', 'report.md', 'README-FIRST.txt'].every((f) => r.report.files.includes(f)) && r.report.tool === 'shopify' && r.report.description === 'Testing the report' && r.report.logHasFinish && /variant/.test(r.report.page)],
      ['image downloader picks each colour to get its picture, named by variant', (r) => r.variantClick.rows.join() === 'Beige:/img/b-900.png,Ivory:/img/a-900.png,Sand:/img/c-900.png' && r.variantClick.product === 'Daily Sun Cream'],
      ['reviews: first run sets the baseline, second run (newest first) stops at last run\'s reviews', (r) => r.reviewsNew.first.rows === 30 && /First run/.test(r.reviewsNew.first.note) && /already have from the last run/.test(r.reviewsNew.second.note) && r.reviewsNew.second.rows <= 20 && r.reviewsNew.second.marked === 0],
      ['store: second run marks nothing new and says so', (r) => r.storeNew.first.rows === 72 && /First run/.test(r.storeNew.first.note) && r.storeNew.second.rows === 72 && r.storeNew.second.marked === 0 && /Nothing new since the last run/.test(r.storeNew.second.note)],
      ['signed-out Google Maps: reads the few reviews shown and says to sign in', (r) => r.mapsLimited.rows === 5 && /aren.t signed in/.test(r.mapsLimited.note)],
      ['store with 13 pages that each grow as you scroll: all 468, every page in full', (r) => r.shopPages.rows === 468 && r.shopPages.unique === 468 && Object.keys(r.shopPages.perPage).length === 13 && Object.values(r.shopPages.perPage).every((n) => n === 36)],
      ['image downloader opens thumbnails: big versions for gallery, linked and lightbox pictures; stays on the page', (r) => ['a', 'b', 'c', 'd'].every((k) => r.galleryThumbs.byKey[k] === 1600) && r.galleryThumbs.byKey.e === 1500 && r.galleryThumbs.byKey.f === 120 && r.galleryThumbs.stayed && r.galleryThumbs.lightboxClosed],
      ['review photos at full size, profile pictures and "1 review · 2 photos" left out', (r) => r.reviewsWheel.withPhotos === 15 && /r0-1/.test(r.reviewsWheel.photo ?? '') && !r.reviewsWheel.avatarAsPhoto && r.reviewsWheel.metaAsText === 0 && r.reviewsWheel.starsOnly === 5],
      ['reviews behind "Show 10 more reviews": all 25 read once', (r) => r.reviewsMore.rows === 25 && r.reviewsMore.unique === 25],
      ['shop grid that loads as you scroll: all 72 products', (r) => r.shopScroll.rows === 72 && r.shopScroll.unique === 72],
      ['protected shop picture loaded through its page', (r) => r.protectedImages.first[0]?.width === '1200'],
      ['company lookup: contacts, address, socials, technology', (r) => r.company.emails === 'wholesale@glowlabs.example.com' && r.company.address === '12 Gangnam-daero, Seoul, KR' && r.company.tech === 'Shopify, Klaviyo' && !!r.company.whatsapp],
      ['technology checker: platform, email tool, server version', (r) => r.tech.row.e_commerce === 'Shopify' && r.tech.row.web_server === 'Nginx 1.25.3'],
      ['link extractor sorts links', (r) => r.links.includes('external https://wa.me/821012345678')],
      ['converter: Markdown, tables, JSON errors, merge', (r) => r.convert.markdownHasHeading && r.convert.tablesFound.length === 1 && /Line 2/.test(r.convert.jsonError) && r.convert.merged.rows.length === 3],
      ['PDF table read exactly', (r) => r.documents.pdfTable.rows.length === 4 && r.documents.pdfTable.rows[1] === 'Snail Essence | 100ml | $21.50'],
      ['invoice fields read', (r) => r.documents.invoice.invoice_number === 'INV-2026-0417' && r.documents.invoice.total === '206.40'],
      ['OCR reads a photographed table', (r) => /Heartleaf Toner/.test(r.documents.ocr.text) && /21\.50/.test(r.documents.ocr.text)],
      ['live: Greenhouse, Lever and Ashby job boards', (r) => (r.jobBoards ? !r.jobBoards.failed && r.jobBoards.rows > 0 : 'skip')],
      ['live: Telegram channel posts', (r) => (r.telegram ? r.telegram.rows > 0 : 'skip')],
      ['live: Reddit community posts', (r) => (r.reddit ? r.reddit.rows > 0 : 'skip')],
      ['live: email checker verdicts', (r) => (r.emailcheck ? r.emailcheck.some((x) => /gmial.*risky/.test(x)) && r.emailcheck.some((x) => /mailinator.*risky/.test(x)) : 'skip')],
      ['live: domain registration and DNS', (r) => (r.domain ? !!r.domain.created && !!r.domain.nameservers : 'skip')],
      ['live: SSL certificate and subdomains', (r) => (r.certificates ? !r.certificates.failed && !!r.certificates[0]?.issuer && Number(r.certificates[0]?.subdomains) > 0 : 'skip')],
      ['live: technology of a real Shopify store', (r) => (r.liveTech ? r.liveTech.e_commerce === 'Shopify' : 'skip')],
      ['live: Amazon keyword search reads 3 result pages', (r) => (r.marketplace ? r.marketplace.unique > 40 && /from 3 pages/.test(r.marketplace.note ?? '') : 'skip')],
    ],
  },
  property: {
    file: 'property-test.mjs',
    about: 'Property viewer: facts, map, floor plan, tour, room sizes to scale, on-device photo labels (network)',
    checks: [
      ['key facts and price shown', (r) => r.price === true && /Beds/.test(r.facts)],
      ['map pin from the listing coordinates', (r) => /marker=34\.05,-118\.24/.test(r.map ?? '')],
      ['feature tags from the listing text', (r) => ['Pool', 'Garage', 'View'].every((f) => r.features.includes(f))],
      ['floor plan shown, or a link when the site blocks it', (r) => r.floorPlan === true],
      ['room chart: "sizes to scale, layout not shown", one box per stated room', (r) => r.chartTitle === true && r.chartRooms === 4],
      ['room table switches to feet', (r) => /18\.0 × 12\.8/.test(r.feetTable)],
      ['network: photos labeled on this computer, most correctly', (r) => (r.photos ? Number(r.accuracy.split('/')[0]) >= Math.ceil(r.photos * 0.6) : 'skip')],
      ['a corrected label is kept after reload', (r) => r.correctionKept === true],
      ['a listing without plan, rooms or tour says so', (r) => r.emptyStates === true],
      ['fits a phone screen', (r) => r.mobileOverflow === false],
      ['no page errors', (r) => r.errors.length === 0],
    ],
  },
  video: {
    file: 'video-test.mjs',
    about: 'Video downloader: streams found while playing, quality choice, joined MP4s, refusals (network)',
    checks: [
      ['a streamed video (blob: player) is found once, with all its qualities', (r) => r.streamList.length === 1 && r.qualities.length === 5],
      ['HLS saved as one MP4 with picture and sound, right length', (r) => r.hls.probe.streams.length === 2 && Math.abs(r.hls.probe.seconds - 634.6) < 2],
      ['the saved HLS video plays and seeks in Edge', (r) => r.hls.plays.played === true && r.hls.plays.duration > 600],
      ['page videos, subtitles and stream links are listed', (r) => r.pageList.length === 4],
      ['plain file and subtitles saved with page-title names', (r) => r.direct.names.join('|') === 'Sample clips.mp4|Sample clips English.vtt'],
      ['encrypted stream is refused with a reason', (r) => /encrypted/.test(r.locked ?? '')],
      ['DASH: separate picture and sound joined into one MP4', (r) => r.dash.probe.streams.length === 2 && r.dash.probe.seconds === 60 && r.dash.plays.played === true],
      ['audio only saved as .m4a', (r) => /\.m4a$/.test(r.audioOnly.name) && r.audioOnly.probe.streams.length === 1],
      ['no panel errors', (r) => r.errors.length === 0],
    ],
  },
  youtube: {
    file: 'youtube-test.mjs',
    about: 'YouTube through yt-dlp: setup steps, embedded players, real saves once the helper is installed (network)',
    checks: [
      ['a YouTube player embedded in another page is listed', (r) => /YouTube video/.test(r.embedListed ?? '')],
      ['without the helper: the setup steps and this copy’s code are shown', (r) => (r.helper === 'not installed' ? r.setupSteps.length === 3 && /^install\.cmd [a-p]{32}$/.test(r.setupCode) : 'skip')],
      ['with the helper: the video’s qualities are listed', (r) => (r.helper === 'installed' ? r.qualities.length > 0 && /zoo/i.test(r.title) : 'skip')],
      ['with the helper: video saved with picture and sound', (r) => (r.helper === 'installed' ? r.video.probe.streams.length === 2 && r.video.probe.seconds === 19 : 'skip')],
      ['with the helper: MP3 saved', (r) => (r.helper === 'installed' ? r.mp3.probe.streams.join() === 'audio:mp3' : 'skip')],
      ['with the helper: subtitles saved', (r) => (r.helper === 'installed' ? /-->/.test(r.subtitles?.start ?? '') : 'skip')],
      ['with the helper: "Show" opens the folder without an error', (r) => (r.helper === 'installed' ? r.showError === '' : 'skip')],
      ['with the helper: pasted YouTube link has a size for each quality and English subtitles first', (r) => (r.helper === 'installed' ? r.linkYouTube.distinctSizes === r.linkYouTube.sizes.length && /English/.test(r.linkYouTube.firstSubtitle) : 'skip')],
      ['with the helper: a pasted link from another site (Internet Archive) lists qualities', (r) => (r.helper === 'installed' ? r.linkArchive.length > 0 : 'skip')],
      ['pasted .mp4 and .m3u8 links are read directly', (r) => (r.helper === 'installed' ? /Save video/.test(r.linkFile) && r.linkHls === 5 : 'skip')],
      ['no panel errors', (r) => r.errors.length === 0 && !r.failure],
    ],
  },
  scrapling: {
    file: 'scrapling-test.mjs',
    about: 'Scrapling engine through the Gleaner helper: Site crawler (robots.txt, limits, stop and continue) and self-healing lists',
    checks: [
      ['the helper starts Scrapling and the Site crawler says so', (r) => /Runs on Scrapling [0-9]/.test(r.engine.text)],
      ['crawl: page limit, same site only, robots.txt obeyed, the browser own User-Agent', (r) => r.crawl.rows === 20 && r.crawl.unique === 20 && !r.crawl.private && !r.crawl.offsite && /robots.txt/.test(r.crawl.note) && r.crawl.uaIsBrowser && r.crawl.first?.title === 'Guide 0'],
      ['stop part way, then continue: every page once', (r) => r.resume.first > 0 && /Stopped early/.test(r.resume.firstNote) && r.resume.overlap === 0 && r.resume.together === 40],
      ['a saved recipe finds its list again after the shop renames it, and is updated', (r) => r.heal.first === 12 && r.heal.second === 12 && r.heal.secondNames === 12 && r.heal.healedSelector !== r.heal.savedSelector && r.heal.adaptiveId === r.heal.savedSelector],
      ['a list that moves again mid-use is found with Scrapling, and the run says so', (r) => r.heal.third === 12 && /found the list again with Scrapling/.test(r.heal.thirdNote ?? '')],
      ['no page errors', (r) => r.errors.length === 0 && !r.failure],
    ],
  },
  capture: {
    file: 'capture-test.mjs',
    about: 'Page capture: AI Markdown, structure, design tokens, components, quotes, packs, full-page capture, Capture Studio, records and evidence, finishing a PDF with the check before filing, EN / 日本語',
    checks: [
      ['text for AI: Markdown with headings and pictures saved beside it', (r) => r.ai.files.includes('page.md') && r.ai.localImages >= 3 && r.ai.headings.some((h) => /Plan your week/.test(h))],
      ['structure: sections in order, calls to action ranked and counted', (r) => r.structure.md === 'header → hero → features → contact → pricing → footer' && r.structure.ctas[0] === 'Start free:primary:2'],
      ['design: colours, the page’s own variables, corners, breakpoints, Tailwind', (r) => r.design.primary === '#2f6feb' && r.design.brandVar === '#2f6feb' && r.design.radius === '14px' && r.design.breakpoints.includes(768) && r.design.tailwind],
      ['component: picked with the keyboard, works on its own, with a preview picture', (r) => r.component.hasButton && r.component.cssHasRadius && r.component.copies.n === 1 && r.component.copies.underline === 'none' && r.component.previewBytes > 2000],
      ['quote: exact words, and a link that jumps to them', (r) => /^> Teams that plan on Monday/.test(r.quote.starts) && /#:~:text=/.test(r.quote.link)],
      ['reference pack: reading order, every part, fingerprints check out', (r) => r.pack.files.includes('START-HERE.md') && r.pack.files.includes('screenshot.png') && r.pack.sumsOk],
      ['whole page: content that loads while scrolling is in the picture', (r) => r.fullPage.lazyLoaded && r.fullPage.image.h >= 4000 && /whole page/.test(r.fullPage.note)],
      ['Studio: black-out is solid in the saved picture', (r) => r.png.secretPixels.black === r.png.secretPixels.of],
      ['Studio: A4 PDF with page breaks', (r) => r.pdf.pages >= 2],
      ['record: original kept apart, history and every fingerprint correct', (r) => r.record.sumsOk && r.record.originalDiffers && r.record.files.includes('original/page.png') && r.record.files.includes('page.mhtml') && r.record.historyActions.includes('undo')],
      ['evidence: submission pack has no original, evidence list in Japanese', (r) => !r.evidence.hasOriginal && /甲第1号証/.test(r.evidence.csv) && r.evidence.exhibitPdf === '甲第1号証 Brightloom pricing page.pdf' && r.evidence.files.includes('timestamp-hash.txt')],
      ['app that scrolls an inner panel: captured in full, page put back', (r) => r.innerPanel.image.h > 3500 && r.innerPanel.pageRestored === 'auto'],
      ['visible area and recent captures', (r) => r.visible.h === 860 && r.recent >= 3],
      ['whole page where the browser refuses the debugger: taken screen by screen, all of it, top bar once', (r) => r.noDebugger.rec.method === 'screen by screen' && r.noDebugger.rec.height >= 5900 && r.noDebugger.rec.reachedBottom && r.noDebugger.pic.redRows >= 5 && r.noDebugger.pic.redRows <= 7],
      ['PDF finisher: opened at 200 dpi, both pages, no crop tool', (r) => /contract\.pdf, 2 pages/.test(r.pdfFinish.header) && r.pdfFinish.image.w === Math.round((595.28 * 200) / 72) && r.pdfFinish.cropShown === 0],
      ['PDF finisher: finished PDF keeps page sizes, numbers pages, no address, secret blacked out', (r) => r.pdfFinish.sub.pages.map((p) => `${p.w}x${p.h}:${p.text}`).join() === '595x842:1 / 2,612x792:2 / 2' && !r.pdfFinish.sub.hasUrl && !r.pdfFinish.sub.hasOriginal && r.pdfFinish.sub.black === true],
      ['check before filing: names the Letter page, passes the rest, in the pack as JSON', (r) => r.pdfFinish.json.failed.join() === 'paper' && r.pdfFinish.checks.some((c) => /^fail: Paper size/.test(c)) && r.pdfFinish.checks.some((c) => /^pass: Password/.test(c)) && /mints/.test(r.pdfFinish.json.rules) && r.pdfFinish.sub.files.includes('check-before-filing.md')],
      ['filing name: masked prefix, exhibit number and title, at the top of the pack', (r) => r.pdfFinish.filingName === '（マスキング）甲第1号証 契約概要.pdf' && r.pdfFinish.sub.rootPdf === r.pdfFinish.filingName && /1 problems? to fix/.test(r.pdfFinish.note)],
      ['preservation pack keeps the PDF exactly as opened', (r) => r.pdfFinish.pre.sourceSame && r.pdfFinish.pre.originalPngs === 0 && r.pdfFinish.pre.report.some((l) => /SHA-256/.test(l))],
      ['日本語: Studio and side panel switch together and remember it', (r) => r.lang.studioJa.save === 1 && r.lang.studioJa.check === 1 && r.lang.studioJa.lang === 'ja' && r.lang.studioJa.firstCheck === 'パスワード・暗号化' && r.lang.panelJa.heading === 1 && r.lang.panelJa.finish === 1 && r.lang.stored === 'ja' && r.lang.afterReload === 1 && r.lang.backToEn === 1],
      ['no page errors', (r) => r.errors.length === 0 && !r.failure],
    ],
  },
  table: {
    file: 'table-test.mjs',
    about: 'Full-page data table, exports, 30,000-row performance',
    checks: [
      ['exports produced files', (r) => [r.csv, r.xlsx, r.json, r.xlsxPics, r.pdf].every((x) => /\d+ bytes$/.test(x) && !/ 0 bytes$/.test(x))],
      ['inline edit survives a reload', (r) => /^1 /.test(r.editPersisted)],
      ['Clean data extracted the SKU number', (r) => r.cleanCell === '100000'],
      ['30,000 rows: DOM stays small (virtualized)', (r) => r.bigDomRows < 80],
      ['30,000 rows: sort under 3 s', (r) => r.bigSortMs < 3000],
    ],
  },
};

const pick = process.argv.slice(2);
const names = pick.length ? pick : Object.keys(SUITES);
for (const n of names) if (!SUITES[n]) throw new Error(`Unknown suite "${n}". Choose from: ${Object.keys(SUITES).join(', ')}`);

console.log('Building the test version of Gleaner...');
const build = spawnSync('npx', ['wxt', 'build', '--mode', 'e2e'], { cwd: root, shell: true, stdio: 'inherit', env: { ...process.env, GLEANER_E2E: '1' } });
if (build.status !== 0) process.exit(build.status ?? 1);

let failed = 0;
let skipped = 0;
for (const n of names) {
  const s = SUITES[n];
  console.log(`\n=== ${n}: ${s.about}`);
  const run = spawnSync(process.execPath, [path.join(here, s.file), ext, shots], { cwd: here, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 45 * 60 * 1000 });
  const out = run.stdout ?? '';
  // Each test prints its results as one JSON object at the end
  const start = out.lastIndexOf('\n{\n');
  let result = null;
  try {
    result = JSON.parse(out.slice(start + 1));
  } catch {
    console.log(out.slice(-2000), run.stderr?.slice(-2000));
  }
  const crash = out.match(/^FAILED .*/m)?.[0];
  if (crash) console.log(`  ! ${crash}`);
  for (const [what, test] of s.checks) {
    let ok;
    try {
      ok = result ? test(result) : false;
    } catch {
      ok = false;
    }
    if (ok === 'skip') {
      skipped++;
      console.log(`  - skipped ${what}`);
    } else if (ok) console.log(`  ok  ${what}`);
    else {
      failed++;
      console.log(`  FAIL ${what}`);
    }
  }
}
console.log(`\n${failed ? `${failed} check(s) failed` : 'All checks passed'}${skipped ? `, ${skipped} skipped` : ''}. Screenshots: ${shots}`);
process.exit(failed ? 1 : 0);
