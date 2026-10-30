import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  autoIcons: { baseIconPath: 'assets/icon.svg' },
  vite: () => ({
    plugins: [tailwindcss()],
    // The photo labeler runs on the plain WebAssembly build of ONNX Runtime (half the size of the
    // GPU build), loaded from inside the extension
    resolve: { alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }] },
  }),
  manifest: {
    name: 'Gleaner - Web Scraper',
    description: 'Point-and-click web scraper. Turn lists, pages, emails, images and stores into spreadsheets.',
    permissions: [
      'storage', 'scripting', 'downloads', 'unlimitedStorage', 'alarms', 'notifications', 'offscreen',
      // Video downloader: notices the video streams a page plays (only on sites Gleaner may read)
      'webRequest',
      // Video downloader on YouTube: hands the video to yt-dlp on this computer (helper/ folder)
      'nativeMessaging',
      // Review analyzer: real mouse-wheel scrolling for lists that ignore script scrolling (Google reviews)
      'debugger',
      // Page capture: the page as MHTML when the debugging interface isn't allowed on a site
      'pageCapture',
      // Tests read back what the Copy buttons put on the clipboard
      ...(process.env.GLEANER_E2E ? ['clipboardRead'] : []),
    ],
    optional_host_permissions: ['<all_urls>'],
    // E2E builds grant site access up front because tests can't click the permission prompt.
    ...(process.env.GLEANER_E2E ? { host_permissions: ['<all_urls>'] } : {}),
    action: { default_title: 'Open Gleaner' },
    // OCR (Tesseract) runs as WebAssembly inside the extension
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
  },
});
