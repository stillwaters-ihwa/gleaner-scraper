// Public posts: Telegram channels, Reddit communities, searches and threads, and Tumblr or any blog
// through its feed.
import { useState } from 'react';
import { newDataset, saveDataset } from '@/lib/db';
import { POST_COLUMNS, feedPosts, redditPosts, redditTarget, telegramChannel, telegramPosts, tumblrFeed, type RedditSort } from '@/lib/verticals/social';
import type { Row } from '@/lib/verticals/structured';
import { Field, NumberInput, Section, Segmented, inputCls } from '../ui';
import { RunBar, useJob } from '../run';

type Platform = 'telegram' | 'reddit' | 'tumblr';

const HELP: Record<Platform, { label: string; placeholder: string; help: string }> = {
  telegram: { label: 'Public channels', placeholder: 't.me/durov\n@telegram', help: 'One per line. Only public channels can be read; private chats and groups cannot.' },
  reddit: { label: 'Communities, searches or threads', placeholder: 'r/AsianBeauty\nsnail mucin review\nhttps://www.reddit.com/r/SkincareAddiction/comments/...', help: 'One per line: a community (r/name), a user (u/name), words to search for, or a thread link (reads its comments too).' },
  tumblr: { label: 'Blogs or feeds', placeholder: 'staff.tumblr.com\nhttps://blog.example.com/feed', help: 'One per line: a Tumblr blog, or the RSS feed of any blog.' },
};

export function SocialPosts() {
  const [platform, setPlatform] = useState<Platform>('telegram');
  const [input, setInput] = useState('');
  const [sort, setSort] = useState<RedditSort>('hot');
  const [max, setMax] = useState(200);
  const job = useJob();
  const lines = input.split('\n').map((s) => s.trim()).filter(Boolean);
  const valid = lines.filter((l) => (platform === 'telegram' ? telegramChannel(l) : platform === 'reddit' ? redditTarget(l, sort) : tumblrFeed(l) || /^https?:\/\//.test(l)));

  function start() {
    job.start(async ({ signal, progress, status }) => {
      const rows: Row[] = [];
      const errors: string[] = [];
      for (const [i, line] of valid.entries()) {
        if (signal.aborted) break;
        try {
          if (platform === 'telegram') {
            const ch = telegramChannel(line);
            status(`Reading t.me/${ch}`);
            const r = await telegramPosts(ch, max, signal, (n) => status(`t.me/${ch}: ${n} posts`));
            rows.push(...r.posts.map((p) => ({ ...p, channel: r.title || ch })));
          } else if (platform === 'reddit') {
            status(`Reading ${line}`);
            rows.push(...(await redditPosts(line, sort, max, signal, (n) => status(`${line}: ${n} posts`))));
          } else {
            const feed = tumblrFeed(line) || line;
            status(`Reading ${feed}`);
            rows.push(...(await feedPosts(feed, /tumblr\.com/.test(feed) ? 'Tumblr' : 'Blog', max, signal)));
          }
        } catch (e: any) {
          errors.push(`${line}: ${e?.message ?? e}`);
        }
        progress(i + 1, valid.length, errors.length);
      }
      if (!rows.length) throw new Error(errors.join(' ') || 'No posts found.');
      const keys = new Set(rows.flatMap((r) => Object.keys(r)));
      const name = `${{ telegram: 'Telegram', reddit: 'Reddit', tumblr: 'Blog' }[platform]} ${valid.length === 1 ? valid[0].replace(/^https?:\/\//, '').slice(0, 40) : `${valid.length} sources`}`;
      return saveDataset({
        ...newDataset('posts', name, valid[0], POST_COLUMNS.filter(([k]) => keys.has(k)).map(([key, label]) => ({ key, label })), rows),
        note: `${rows.length} posts.${errors.length ? ` Couldn't read: ${errors.join('; ')}` : ''}`,
      });
    });
  }

  const h = HELP[platform];
  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Source">
        <p className="text-[12.5px] leading-relaxed text-muted">Public posts with their date, views or score, comment count, media and sentiment. Reads only what anyone can see without signing in.</p>
        <Segmented
          label="Platform"
          value={platform}
          onChange={setPlatform}
          options={[
            { value: 'telegram', label: 'Telegram' },
            { value: 'reddit', label: 'Reddit' },
            { value: 'tumblr', label: 'Tumblr and blogs' },
          ]}
        />
        <Field label={`${h.label}${valid.length ? ` (${valid.length})` : ''}`} help={h.help}>
          {(id) => <textarea id={id} rows={4} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder={h.placeholder} className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'} />}
        </Field>
        {platform === 'reddit' && (
          <Segmented
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'hot', label: 'Hot' },
              { value: 'new', label: 'New' },
              { value: 'top', label: 'Top this month' },
              { value: 'rising', label: 'Rising' },
            ]}
          />
        )}
        <Field label="Most posts per source">{(id) => <NumberInput id={id} value={max} onChange={setMax} min={1} max={5000} />}</Field>
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={valid.length ? `Read ${valid.length} ${valid.length === 1 ? 'source' : 'sources'}` : 'Read posts'} disabled={!valid.length} />
    </div>
  );
}
