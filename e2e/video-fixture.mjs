// Test pages for the Video downloader. The videos themselves are public streaming test streams
// (Mux, Shaka, test-videos.co.uk), played the way real sites play them.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 8770);
const MUX = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta property="og:title" content="${title}"></head><body>${body}</body></html>`;

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (type, body, status = 200) => (res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*' }), res.end(body));
    if (url.pathname === '/stream') {
      // A site that streams with hls.js (MediaSource), so the video element only shows a blob: address
      return send('text/html', page('Big Buck Bunny stream', `<video id="v" muted autoplay playsinline width="480"></video>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js"></script>
        <script>const h = new Hls(); h.loadSource(${JSON.stringify(MUX)}); h.attachMedia(document.getElementById('v'));</script>`));
    }
    if (url.pathname === '/page') {
      return send('text/html', page('Sample clips', `<video controls width="480" poster="https://test-videos.co.uk/user/pages/images/big_buck_bunny.jpg">
          <source src="https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4" type="video/mp4">
          <track src="/subs/en.vtt" srclang="en" label="English">
        </video>
        <p><a href="https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd">Angel One (DASH)</a></p>
        <p><a href="/locked/master.m3u8">Locked stream</a></p>`));
    }
    if (url.pathname === '/subs/en.vtt') return send('text/vtt', 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n');
    if (url.pathname === '/locked/master.m3u8') return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow.m3u8\n');
    if (url.pathname === '/locked/low.m3u8') return send('application/vnd.apple.mpegurl', '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg0.ts\n#EXT-X-ENDLIST\n');
    if (url.pathname === '/play') {
      return send('text/html', `<!doctype html><video id="v" muted src="/file?p=${encodeURIComponent(url.searchParams.get('p'))}"></video>`);
    }
    if (url.pathname === '/file') {
      const p = url.searchParams.get('p');
      if (!p || !fs.existsSync(p)) return send('text/plain', 'missing', 404);
      // Byte ranges, so the player can seek
      const size = fs.statSync(p).size;
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      if (!m) return (res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': size, 'accept-ranges': 'bytes' }), fs.createReadStream(p).pipe(res));
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, { 'content-type': 'video/mp4', 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
      return fs.createReadStream(p, { start, end }).pipe(res);
    }
    send('text/plain', 'not found', 404);
  })
  .listen(port, () => console.log('video fixture on', port));
