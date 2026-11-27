// Plays an exhibition game at fast speed until half time and screenshots the half-time show.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1100 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL('site/play/index.html').href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(400);
await page.click('#title');
await sleep(150);
await page.click('#goExhibition').catch(() => {}); await page.click('[data-team=\"0\"]');
await page.evaluate(() => { window.__fnd.setPlayClock(false); window.__fnd.setSpeed(2); });
let shown = false;
for (let i = 0; i < 20000 && !shown; i++) {
  const s = await page.evaluate(() => window.__fnd.state());
  if (s.mode === 'final') break;
  if (await page.$('#banner .show')) { await sleep(300); await page.screenshot({ path: `${out}/halftime.png` }); shown = true; console.log(await page.$eval('#banner .show', (e) => e.innerText)); break; }
  if (s.mode !== 'choose') { await sleep(20); continue; }
  const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
  const prompt = await page.$eval('#prompt', (e) => e.textContent);
  let pick = acts.includes('snap') ? ['snap'] : acts.filter((a) => a.startsWith('p:') || a.startsWith('d:') || a.startsWith('k:') || a === 'pat');
  if (prompt.startsWith('4th') && acts.includes('punt')) pick = [acts.includes('fg') ? 'fg' : 'punt'];
  if (pick.length) await page.click(`#panel [data-act="${pick[i % pick.length]}"]`).catch(() => {});
  await sleep(20);
}
console.log(JSON.stringify({ shown, announcer: await page.$eval('#pa', (e) => e.textContent), errors }));
await browser.close();
