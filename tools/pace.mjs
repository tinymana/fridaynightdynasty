// How long plays take to watch at normal speed, with calls made at once. Run: node tools/pace.mjs [seconds]
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const secs = Number(process.argv[2] ?? 80);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(pathToFileURL('site/play/index.html').href + '?lowres');
await sleep(400); await page.click('#title'); await sleep(150);
await page.click('#goExhibition'); await sleep(150); await page.click('[data-team="0"]');
const t0 = Date.now(); let calls = 0;
while (Date.now() - t0 < secs * 1000) {
  const s = await page.evaluate(() => window.__fnd.state());
  if (s.mode === 'choose') {
    const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
    const pick = acts.includes('snap') ? 'snap' : acts.find((a) => a.startsWith('k:')) ?? acts.find((a) => a.startsWith('p:')) ?? acts.find((a) => a.startsWith('d:')) ?? acts.find((a) => a === 'pat') ?? acts[0];
    if (pick) { await page.evaluate((a) => document.querySelector(`#panel [data-act="${a}"]`)?.click(), pick); if (pick !== 'snap') calls++; }
  }
  await sleep(30);
}
const s = await page.evaluate(() => window.__fnd.state());
console.log(JSON.stringify({ seconds: secs, calls, state: s }));
await browser.close();
