import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(pathToFileURL('site/play/index.html').href);
await sleep(400); await page.click('#title'); await sleep(150);
await page.select('#weatherPick', 'rain'); await page.select('#quarterPick', '6');
await page.screenshot({ path: '/tmp/fnd-shots/setup.png' });
await page.click('#goExhibition').catch(() => {}); await page.click('[data-team=\"0\"]');
await page.evaluate(() => { window.__fnd.setSpeed(2); window.__fnd.setPlayClock(false); window.__fnd.setTurbo?.(false); });
const seen = new Set(); let kickShot = false;
for (let i = 0; i < 6000 && seen.size < 4; i++) {
  const s = await page.evaluate(() => window.__fnd.state());
  if (s.mode === 'final') break;
  if (s.cutin && !seen.has(s.cutin)) { seen.add(s.cutin); await sleep(350); await page.screenshot({ path: `/tmp/fnd-shots/cutin-${seen.size}.png` }); console.log('cutin', s.cutin); }
  if (s.mode === 'choose') {
    const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
    if (acts.includes('k:deep') && !kickShot) { kickShot = true; await page.screenshot({ path: '/tmp/fnd-shots/kick-panel.png' }); }
    if (acts.includes('block') && !seen.has('blockshot')) { seen.add('blockshot'); await page.screenshot({ path: '/tmp/fnd-shots/block-panel.png' }); console.log('block panel'); }
    const pick = acts.includes('snap') ? 'snap' : acts.find((a) => a.startsWith('k:')) ?? (acts.includes('pat') ? 'pat' : acts.includes('fg') && i % 2 ? 'fg' : acts.filter((a) => a.startsWith('p:') || a.startsWith('d:'))[i % 5] ?? acts[0]);
    await page.click(`#panel [data-act="${pick}"]`).catch(() => {});
  }
  await sleep(40);
}
console.log('setup', JSON.stringify((await page.evaluate(() => window.__fnd.state())).setup), 'errors', errors);
await browser.close();
