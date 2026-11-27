// Screenshots of the field alone: at the line, in the middle of a play, and after a tackle.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL('site/play/index.html').href + (process.env.LOWRES ? '?lowres' : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500); await page.click('#title'); await sleep(150); await page.click('#goExhibition'); await page.click('[data-team="0"]');
await page.evaluate(() => { window.__fnd.setPlayClock(false); window.__fnd.setSpeed(1); });
const stage = await page.$('#stage');
let shots = 0, plays = 0;
for (let i = 0; i < 3000 && shots < 4; i++) {
  const s = await page.evaluate(() => window.__fnd.state());
  if (s.mode === 'choose') {
    const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
    if (acts.includes('snap')) { if (shots === 0) { await sleep(200); await stage.screenshot({ path: `${out}/field-line.png` }); shots++; } await page.click('#panel [data-act="snap"]'); plays++; continue; }
    const pick = acts.find((a) => a.startsWith('k:')) ?? acts.find((a) => a.startsWith('p:')) ?? acts.find((a) => a.startsWith('d:')) ?? acts.find((a) => a === 'pat');
    if (pick) await page.click(`#panel [data-act="${pick}"]`).catch(() => {});
  } else if (s.mode === 'live' && plays >= 1 && shots === 1) { await sleep(900); await stage.screenshot({ path: `${out}/field-play.png` }); shots++; }
  else if (s.mode === 'post' && shots === 2) { await stage.screenshot({ path: `${out}/field-post.png` }); shots++; }
  else if (s.mode === 'kick' && shots === 3) { await sleep(300); await stage.screenshot({ path: `${out}/field-kick.png` }); shots++; }
  await sleep(25);
}
console.log(JSON.stringify({ shots, errors }));
await browser.close();
