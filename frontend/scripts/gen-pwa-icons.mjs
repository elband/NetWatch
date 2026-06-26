// Generate ikon PWA (PNG) dari public/favicon.svg dengan background solid
// (perlu background solid agar ikon tidak transparan/aneh di homescreen Android/iOS).
// Jalankan: npm i -D sharp && node scripts/gen-pwa-icons.mjs (sharp tidak disimpan
// sebagai dependency permanen, cuma dipakai sesekali saat logo berubah).
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, '..', 'public');
const svg = readFileSync(join(pub, 'favicon.svg'));
const BG = '#0b0d12'; // samakan dengan warna --color-bg (dark theme)

async function make(size, file, { padding = 0 } = {}) {
  const inner = size - padding * 2;
  const logo = await sharp(svg).resize(inner, inner).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, top: padding, left: padding }])
    .png()
    .toFile(join(pub, file));
  console.log('✓', file);
}

await make(192, 'pwa-192.png');
await make(512, 'pwa-512.png');
await make(512, 'pwa-maskable-512.png', { padding: 64 }); // safe-zone utk maskable
await make(180, 'apple-touch-icon.png', { padding: 18 });
