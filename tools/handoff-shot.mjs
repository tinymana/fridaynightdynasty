// Frames of a handoff: calls a dive and photographs the backfield over the first second. Run: LOWRES= node tools/handoff-shot.mjs
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const out = '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL('site/play/index.html').href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500); await page.click('#title'); await sleep(150); await page.click('#goExhibition'); await page.click('[data-team="0"]');
await page.evaluate(() => { window.__fnd.setPlayClock(false); window.__fnd.setSpeed(1); });
const stage = await page.$('#stage');
let shots = 0;
for (let i = 0; i < 2500 && shots === 0; i++) {
  const s = await page.evaluate(() => window.__fnd.state());
  if (s.mode === 'choose') {
    const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
    if (acts.includes('snap')) {
      await page.click('#panel [data-act="snap"]');
      for (let k = 0; k < 6; k++) { await sleep(k === 0 ? 1050 : 110); await stage.screenshot({ path: `${out}/handoff-${k}.png` }); shots++; }
      break;
    }
    const pick = acts.find((a) => a.startsWith('k:')) ?? acts.find((a) => a.startsWith('p:') && /dive|iso|power/i.test(a)) ?? acts.find((a) => a.startsWith('d:'));
    if (pick) await page.click(`#panel [data-act="${pick}"]`).catch(() => {});
    else { const tab = acts.find((a) => a.startsWith('f:') || a.startsWith('tab:')); if (tab) await page.click(`#panel [data-act="${tab}"]`).catch(() => {}); }
  }
  await sleep(25);
}
console.log(JSON.stringify({ shots, errors }));
await browser.close();
