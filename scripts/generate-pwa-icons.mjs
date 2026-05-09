/**
 * Rasterise public/favicon.svg → PNG icons for the PWA manifest.
 * Run with: node scripts/generate-pwa-icons.mjs
 *
 * The SVG is 48×46 (slightly non-square). We pad it onto a square transparent
 * canvas centred, then rasterise at 192×192 and 512×512 — those are the sizes
 * Chrome / Edge require for installability. Output goes to public/icons/.
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'public', 'favicon.svg');
const outDir  = resolve(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(svgPath);

const sizes = [192, 512];
for (const size of sizes) {
  // Padded resize: contain inside a square with transparent background, then
  // serialise to PNG. Density bump renders the SVG at a higher rasterisation
  // resolution so blur filters look crisp at large output sizes.
  const out = resolve(outDir, `icon-${size}.png`);
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log(`wrote ${out}`);
}
