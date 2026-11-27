// Plays part of a game in the given weather and screenshots the field, to see how it wears.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const weather = process.argv[2] ?? 'rain';
const plays = Number(process.argv[3] ?? 40);
const limit = Date.now() + 70000;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL('site/play/index.html').href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500); await page.click('#title'); await sleep(150); await page.click('#goExhibition');
await page.select('#weatherPick', weather);
await page.click('[data-team="0"]');
await page.evaluate(() => { window.__fnd.setPlayClock(false); window.__fnd.setSpeed(0); });
let n = 0;
for (let i = 0; i < 4000 && n < plays && Date.now() < limit; i++) {
  const s = await page.evaluate(() => window.__fnd.state());
  if (s.mode === 'final') break;
  if (s.mode === 'choose') {
    const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
    const pick = acts.includes('snap') ? 'snap' : acts.find((a) => a.startsWith('k:')) ?? acts.filter((a) => a.startsWith('p:'))[i % 5] ?? acts.find((a) => a.startsWith('d:')) ?? acts.find((a) => a === 'pat');
    if (pick) { await page.click(`#panel [data-act="${pick}"]`).catch(() => {}); if (pick === 'snap' || pick.startsWith('d:')) n++; }
  }
  await sleep(15);
}
await sleep(300);
await (await page.$('#stage')).screenshot({ path: `/tmp/fnd-shots/turf-${weather}.png` });
console.log(JSON.stringify({ weather, n, errors }));
await browser.close();
