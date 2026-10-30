// Copies the PDF and OCR engines into public/vendor so they ship inside the extension and work
// offline (extensions may not load code from the internet). Runs after npm install.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const out = path.join(root, 'public', 'vendor');
fs.mkdirSync(path.join(out, 'ocr'), { recursive: true });
fs.mkdirSync(path.join(out, 'ort'), { recursive: true });
const files = [
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'ocr/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'ocr/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'ocr/eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz', 'ocr/kor.traineddata.gz'],
  // ONNX Runtime (WebAssembly) for the room-photo labeler; the model itself downloads on first use
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs'],
];
for (const [from, to] of files) {
  const src = path.join(root, from);
  if (!fs.existsSync(src)) {
    console.warn(`copy-assets: missing ${from}`);
    continue;
  }
  fs.copyFileSync(src, path.join(out, to));
}
console.log('copy-assets: PDF and OCR engines copied to public/vendor');
