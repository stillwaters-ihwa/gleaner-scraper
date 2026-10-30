// Public social posts: Telegram channels (their public web preview), Reddit communities, searches
// and threads (Reddit's public JSON), and Tumblr or any blog through its RSS feed.
import { compact, str, type Row } from './structured';
import { sentiment } from './sentiment';
import { parseFeed } from './news';

export const POST_COLUMNS = [
  ['platform', 'platform'],
  ['channel', 'channel / community'],
  ['author', 'author'],
  ['title', 'title'],
  ['text', 'text'],
  ['date', 'date'],
  ['views', 'views'],
  ['score', 'score / likes'],
  ['comments', 'comments'],
  ['media', 'media'],
  ['link', 'link in post'],
  ['sentiment', 'sentiment'],
  ['url', 'url'],
] as const;

const withSentiment = (r: Row): Row => ({ ...r, sentiment: sentiment(`${r.title ?? ''} ${r.text ?? ''}`).label });

// ---------- Telegram ----------

/** "t.me/durov", "https://t.me/s/durov", "@durov" -> "durov". */
export function telegramChannel(input: string): string {
  const m = input.trim().match(/(?:t\.me\/(?:s\/)?|telegram\.me\/(?:s\/)?|^@)([A-Za-z0-9_]{4,64})/i) ?? input.trim().match(/^([A-Za-z0-9_]{4,64})$/);
  return m?.[1] ?? '';
}

const viewsNum = (s: string) => {
  const m = s.trim().match(/([\d.]+)\s*([KM])?/i);
  if (!m) return '';
  return String(Math.round(parseFloat(m[1]) * (m[2]?.toUpperCase() === 'M' ? 1e6 : m[2] ? 1e3 : 1)));
};

/** One page of a public Telegram channel's posts, newest first, plus the id to page back from. */
export function parseTelegramPage(html: string, channel: string): { posts: Row[]; before: number | null; title: string; subscribers: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = str(doc.querySelector('.tgme_channel_info_header_title')?.textContent);
  const subscribers = Array.from(doc.querySelectorAll('.tgme_channel_info_counter')).map((c) => str(c.textContent)).find((t) => /subscriber|member/i.test(t)) ?? '';
  let min: number | null = null;
  const posts = Array.from(doc.querySelectorAll('.tgme_widget_message[data-post]')).map((el) => {
    const post = el.getAttribute('data-post') ?? '';
    const id = Number(post.split('/').pop());
    if (id && (min === null || id < min)) min = id;
    const textEl = el.querySelector('.tgme_widget_message_text');
    const photo = el.querySelector('.tgme_widget_message_photo_wrap')?.getAttribute('style')?.match(/url\(['"]?([^'")]+)/)?.[1] ?? '';
    const video = el.querySelector('video')?.getAttribute('src') ?? '';
    const link = Array.from(textEl?.querySelectorAll('a[href^="http"]') ?? []).map((a) => a.getAttribute('href')!).find((h) => !/t\.me\//.test(h)) ?? '';
    return withSentiment(
      compact({
        platform: 'Telegram',
        channel: title || channel,
        author: str(el.querySelector('.tgme_widget_message_forwarded_from_name')?.textContent) ? `forwarded from ${str(el.querySelector('.tgme_widget_message_forwarded_from_name')?.textContent)}` : '',
        text: str((textEl as HTMLElement | null)?.innerText ?? textEl?.textContent),
        date: str(el.querySelector('.tgme_widget_message_date time')?.getAttribute('datetime')).slice(0, 19).replace('T', ' '),
        views: viewsNum(str(el.querySelector('.tgme_widget_message_views')?.textContent)),
        media: photo || video,
        link,
        url: `https://t.me/${post}`,
      }),
    );
  });
  return { posts: posts.reverse(), before: min, title, subscribers };
}

/** Recent posts from a public Telegram channel, going back page by page. */
export async function telegramPosts(channel: string, max: number, signal?: AbortSignal, onPage?: (n: number) => void): Promise<{ posts: Row[]; title: string; subscribers: string }> {
  const out: Row[] = [];
  let before: number | null = null;
  let title = '';
  let subscribers = '';
  for (let page = 0; page < 200 && out.length < max; page++) {
    const res = await fetch(`https://t.me/s/${encodeURIComponent(channel)}${before ? `?before=${before}` : ''}`, { signal });
    if (!res.ok) throw new Error(`Telegram answered with HTTP ${res.status}.`);
    const p = parseTelegramPage(await res.text(), channel);
    if (page === 0) {
      title = p.title;
      subscribers = p.subscribers;
      if (!p.posts.length) throw new Error(`"${channel}" has no public posts. Only public channels can be read, not private chats or groups.`);
    }
    out.push(...p.posts);
    onPage?.(out.length);
    if (!p.before || p.before <= 1 || p.posts.length === 0) break;
    before = p.before;
    await new Promise((r) => setTimeout(r, 700));
  }
  return { posts: out.slice(0, max), title, subscribers };
}

// ---------- Reddit ----------

export type RedditSort = 'hot' | 'new' | 'top' | 'rising';

/** What a Reddit input points at: a community, a search, a user, or one thread. */
export function redditTarget(input: string, sort: RedditSort): { url: string; kind: 'listing' | 'thread' } | null {
  const s = input.trim();
  const thread = s.match(/reddit\.com(\/r\/[\w]+\/comments\/[\w]+(?:\/[^/?#]*)?)/i);
  if (thread) return { url: `https://www.reddit.com${thread[1].replace(/\/$/, '')}.json?limit=200`, kind: 'thread' };
  const sub = s.match(/(?:reddit\.com\/)?(?:^|\/)r\/([\w]+)/i) ?? s.match(/^([\w]{2,21})$/);
  if (sub) return { url: `https://www.reddit.com/r/${sub[1]}/${sort}.json?limit=100${sort === 'top' ? '&t=month' : ''}`, kind: 'listing' };
  const user = s.match(/(?:reddit\.com\/)?(?:^|\/)u(?:ser)?\/([\w-]+)/i);
  if (user) return { url: `https://www.reddit.com/user/${user[1]}/submitted.json?limit=100&sort=${sort === 'top' ? 'top' : 'new'}`, kind: 'listing' };
  if (s.length >= 2) return { url: `https://www.reddit.com/search.json?q=${encodeURIComponent(s)}&limit=100&sort=${sort === 'hot' ? 'relevance' : sort}`, kind: 'listing' };
  return null;
}

function redditPost(d: any): Row {
  const media = d.url_overridden_by_dest && /\.(jpe?g|png|gif|webp|mp4)$|i\.redd\.it|v\.redd\.it|imgur/i.test(d.url_overridden_by_dest) ? d.url_overridden_by_dest : '';
  return withSentiment(
    compact({
      platform: 'Reddit',
      channel: d.subreddit_name_prefixed ?? '',
      author: d.author && d.author !== '[deleted]' ? `u/${d.author}` : '',
      title: str(d.title),
      text: str(d.selftext ?? d.body).slice(0, 4000),
      date: d.created_utc ? new Date(d.created_utc * 1000).toISOString().slice(0, 16).replace('T', ' ') : '',
      score: d.score != null ? String(d.score) : '',
      comments: d.num_comments != null ? String(d.num_comments) : '',
      media,
      link: !media && d.url_overridden_by_dest && !/reddit\.com/.test(d.url_overridden_by_dest) ? d.url_overridden_by_dest : '',
      url: d.permalink ? `https://www.reddit.com${d.permalink}` : '',
    }),
  );
}

/** The RSS address for the same Reddit listing or thread (Reddit's own public feeds). */
export function redditRssUrl(jsonUrl: string): string {
  const u = new URL(jsonUrl);
  u.searchParams.delete('limit');
  u.pathname = u.pathname.endsWith('search.json') ? u.pathname.replace(/search\.json$/, 'search.rss') : u.pathname.replace(/\.json$/, '/.rss');
  return u.href;
}

/** Posts from Reddit's RSS feed: title, author, date, text and links, but no vote or comment counts. */
export function parseRedditRss(xml: string): Row[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(doc.getElementsByTagName('entry')).map((e) => {
    const get = (tag: string) => e.getElementsByTagName(tag)[0];
    const html = get('content')?.textContent ?? '';
    const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    // The feed appends "submitted by /u/x [link] [comments]"; keep the post itself
    body.querySelectorAll('table, span, a[href*="/comments/"]').forEach((n) => n.textContent?.match(/submitted by|\[link\]|\[comments\]/) && n.remove());
    const link = Array.from(body.querySelectorAll('a[href^="http"]')).map((a) => a.getAttribute('href')!).find((h) => !/reddit\.com|redd\.it/.test(h)) ?? '';
    const media = Array.from(body.querySelectorAll('img')).map((i) => i.getAttribute('src')).find(Boolean) ?? '';
    const author = str(get('author')?.getElementsByTagName('name')[0]?.textContent).replace(/^\/?u\//, '');
    return withSentiment(
      compact({
        platform: 'Reddit',
        channel: str(get('category')?.getAttribute('label') ?? (get('category')?.getAttribute('term') ? `r/${get('category')!.getAttribute('term')}` : '')),
        author: author ? `u/${author}` : '',
        title: str(get('title')?.textContent),
        text: str(body.textContent).replace(/submitted by.*$/i, '').slice(0, 4000),
        date: str(get('published')?.textContent ?? get('updated')?.textContent).slice(0, 16).replace('T', ' '),
        media,
        link,
        url: get('link')?.getAttribute('href') ?? '',
      }),
    );
  });
}

/** Posts from a Reddit community, search or user, or a thread with its comments. */
export async function redditPosts(input: string, sort: RedditSort, max: number, signal?: AbortSignal, onPage?: (n: number) => void): Promise<Row[]> {
  const t = redditTarget(input, sort);
  if (!t) throw new Error('Enter a community (r/skincareaddiction), a search, a user, or a thread link.');
  const get = async (url: string) => {
    // Signed-in browsers get Reddit's full data (scores, comment counts)
    const res = await fetch(url, { signal, credentials: 'include', headers: { accept: 'application/json' } });
    if (res.status === 403 || res.status === 401) throw new RedditBlocked();
    if (res.status === 429) throw new Error('Reddit is limiting requests right now. Wait a minute and run again.');
    if (!res.ok) throw new Error(`Reddit answered with HTTP ${res.status}.`);
    return res.json();
  };
  try {
    return await redditJson(t, get, max, onPage);
  } catch (e) {
    if (!(e instanceof RedditBlocked)) throw e;
    // Reddit only serves its JSON to signed-in visitors now; its public RSS feeds still work
    const res = await fetch(redditRssUrl(t.url), { signal, credentials: 'include' });
    if (res.status === 403 || res.status === 404) throw new Error('Reddit refused the request (the community may be private, banned, or need a sign-in).');
    if (!res.ok) throw new Error(`Reddit answered with HTTP ${res.status}.`);
    const rows = parseRedditRss(await res.text()).slice(0, max);
    onPage?.(rows.length);
    return rows;
  }
}

class RedditBlocked extends Error {}

async function redditJson(t: { url: string; kind: 'listing' | 'thread' }, get: (url: string) => Promise<any>, max: number, onPage?: (n: number) => void): Promise<Row[]> {
  if (t.kind === 'thread') {
    const [post, comments] = await get(t.url);
    const out = [redditPost(post.data.children[0].data)];
    const walk = (list: any[], depth: number) => {
      for (const c of list ?? []) {
        if (c.kind !== 't1' || out.length >= max) continue;
        const row = redditPost(c.data);
        row.title = depth ? `reply (level ${depth + 1})` : 'comment';
        row.url = row.url || out[0].url;
        out.push(row);
        walk(c.data.replies?.data?.children, depth + 1);
      }
    };
    walk(comments.data.children, 0);
    return out;
  }
  const out: Row[] = [];
  let after = '';
  for (let page = 0; page < 20 && out.length < max; page++) {
    const data = await get(t.url + (after ? `&after=${after}` : ''));
    out.push(...(data.data?.children ?? []).filter((c: any) => c.kind === 't3').map((c: any) => redditPost(c.data)));
    onPage?.(out.length);
    after = data.data?.after;
    if (!after) break;
    await new Promise((r) => setTimeout(r, 1200)); // Reddit allows only a few requests a minute without an account key
  }
  return out.slice(0, max);
}

// ---------- Tumblr and any blog ----------

/** "staff.tumblr.com" / "tumblr.com/staff" -> the blog's RSS feed. */
export function tumblrFeed(input: string): string {
  const s = input.trim();
  const sub = s.match(/([\w-]+)\.tumblr\.com/i);
  if (sub && sub[1] !== 'www') return `https://${sub[1]}.tumblr.com/rss`;
  const path = s.match(/tumblr\.com\/(?:blog\/)?([\w-]+)/i);
  if (path) return `https://${path[1]}.tumblr.com/rss`;
  return '';
}

export async function feedPosts(feedUrl: string, platform: string, max: number, signal?: AbortSignal): Promise<Row[]> {
  const res = await fetch(feedUrl, { signal });
  if (!res.ok) throw new Error(`The feed answered with HTTP ${res.status}.`);
  return parseFeed(await res.text(), feedUrl)
    .slice(0, max)
    .map((r) => compact({ platform, channel: r.publisher, author: r.author, title: r.title, text: r.summary, date: r.published, media: r.image, url: r.url, sentiment: r.sentiment }));
}

