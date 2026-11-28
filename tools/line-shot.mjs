// Screenshot of the look at the line (audible panel), and of a ball-carrier move callout if one turns up.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1100 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL('site/play/index.html').href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
await sleep(400);
await page.click('#title');
await sleep(150);
await page.click('#goExhibition').catch(() => {}); await page.click('[data-team=\"0\"]');
await page.evaluate(() => { window.__fnd.setPlayClock(false); window.__fnd.setSpeed(1); });
let line = false, move = false, audibles = 0;
for (let i = 0; i < 4000 && !(line && move && audibles >= 2); i++) {
  const s = await st();
  if (s.mode === 'final') break;
  if (!move && await page.$eval('#moveTag', (e) => !e.classList.contains('hidden') && e.textContent.length > 0).catch(() => false)) { await (await page.$('#stage')).screenshot({ path: `${out}/move.png` }); move = true; console.log('move:', await page.$eval('#moveTag', (e) => e.textContent)); }
  if (s.mode !== 'choose') { await sleep(30); continue; }
  const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
  if (acts.includes('snap')) {
    if (!line) { await sleep(120); await page.screenshot({ path: `${out}/line.png` }); line = true; console.log('prompt:', await page.$eval('#prompt', (e) => e.textContent)); }
    if (acts.includes('aud') && !acts.some((a) => a.startsWith('a:')) && audibles < 2) { await page.click('#panel [data-act="aud"]'); await sleep(120); await page.screenshot({ path: `${out}/audible.png` }); continue; }
    const aud = acts.filter((a) => a.startsWith('a:'));
    if (aud.length && audibles < 2) { await page.click(`#panel [data-act="${aud[0]}"]`); audibles++; await sleep(200); console.log('calls:', await page.$eval('#calls', (e) => e.textContent), '| banner:', await page.$eval('#banner', (e) => e.textContent)); }
    else await page.click('#panel [data-act="snap"]');
    continue;
  }
  const pick = acts.filter((a) => a.startsWith('p:') || a.startsWith('d:') || a.startsWith('k:') || a === 'pat');
  if (pick.length) await page.click(`#panel [data-act="${pick[i % pick.length]}"]`).catch(() => {});
  await sleep(30);
}
console.log(JSON.stringify({ line, move, audibles, errors }));
await browser.close();
