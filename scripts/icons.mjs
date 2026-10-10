// Builds the app icons from public/logo-mark.svg. Run: npm run icons
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

const mark = await readFile(new URL('../public/logo-mark.svg', import.meta.url));

async function icon(size, pad, bg, out) {
  const inner = Math.round(size * (1 - pad * 2));
  const art = await sharp(mark, { density: 512 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toFile(new URL(`../public/${out}`, import.meta.url).pathname);
}

await icon(192, 0.1, '#FFFFFF', 'icon-192.png');
await icon(512, 0.1, '#FFFFFF', 'icon-512.png');
await icon(512, 0.2, '#FFFFFF', 'icon-maskable-512.png');
await icon(180, 0.1, '#FFFFFF', 'apple-touch-icon.png');
await writeFile(new URL('../public/favicon.svg', import.meta.url), mark);
console.log('icons written');
