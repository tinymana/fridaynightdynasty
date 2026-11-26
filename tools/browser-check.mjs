// Drives the built client in headless Chrome: screenshots, a full coached game, and a determinism cross-check.
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(pathToFileURL('site/play/index.html').href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500);
await page.screenshot({ path: `${out}/1-title.png` });
console.log('browser hash seed 2026:', await page.evaluate(() => window.__fnd.selftest(2026)));
await page.click('#title');
await sleep(200);
await page.screenshot({ path: `${out}/2-setup.png` });
await page.click('[data-team="0"]');
const waitChoose = async () => { for (let i = 0; i < 400; i++) { const s = await page.evaluate(() => window.__fnd.state()); if (s.mode === 'choose' || s.mode === 'final') return s; await sleep(50); } throw new Error('stuck: ' + JSON.stringify(await page.evaluate(() => window.__fnd.state()))); };
let s = await waitChoose();
await page.screenshot({ path: `${out}/3-call.png` });
await page.click('#panel .card');
await sleep(1500);
await page.screenshot({ path: `${out}/4-live.png` });
s = await waitChoose();
await page.screenshot({ path: `${out}/5-next.png` });
await page.evaluate(() => window.__fnd.setSpeed(0));
let shotDef = false, n = 0;
while (s.mode !== 'final' && n++ < 600) {
  const prompt = await page.$eval('#prompt', (e) => e.textContent);
  if (!shotDef && prompt.includes('front')) { await page.screenshot({ path: `${out}/6-defense.png` }); shotDef = true; }
  const cards = await page.$$('#panel [data-act]');
  const acts = await Promise.all(cards.map((c) => c.evaluate((e) => e.dataset.act)));
  let pick = acts.filter((a) => a.startsWith('p:') || a.startsWith('d:') || a.startsWith('k:') || a === 'pat');
  if (prompt.startsWith('4th') && acts.includes('punt')) pick = [acts.includes('fg') ? 'fg' : 'punt'];
  const a = pick[n % pick.length];
  await page.click(`#panel [data-act="${a}"]`);
  await sleep(30);
  s = await waitChoose();
}
await sleep(300);
await page.screenshot({ path: `${out}/7-final.png` });
console.log('final state:', JSON.stringify(s), 'decisions made:', n);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
