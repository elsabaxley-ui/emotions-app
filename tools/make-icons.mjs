import puppeteer from 'puppeteer-core';
import fs from 'fs';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const jobs = [
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'apple-touch-icon.png', 180],
  ['tools/icon-maskable.svg', 'icon-maskable-512.png', 512],
];
for (const [src, out, size] of jobs) {
  const p = await b.newPage();
  await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const svg = fs.readFileSync(src, 'utf8');
  await p.setContent(`<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await p.screenshot({ path: out, omitBackground: false });
  await p.close();
  console.log(out, size);
}
await b.close();
