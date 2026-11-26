// Captures the screenshots used on the website from the built game.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const out = 'site/assets';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 1000, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL('site/play/index.html').href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(400);
await page.click('#title');
await sleep(150);
await page.click('[data-team="0"]');
const st = () => page.evaluate(() => window.__fnd.state());
const waitChoose = async () => { for (let i = 0; i < 600; i++) { const s = await st(); if (s.mode === 'choose' || s.mode === 'final') return s; await sleep(50); } throw new Error('stuck'); };
const shot = async (sel, name) => { const el = await page.$(sel); await el.screenshot({ path: `${out}/${name}.png` }); };
const done = { off: false, def: false, live: false };
let s = await waitChoose();
for (let n = 0; s.mode !== 'final' && n < 700; n++) {
  const prompt = await page.$eval('#prompt', (e) => e.textContent);
  const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
  if (!done.off && prompt === 'Call your play') { await shot('#game', 'shot_offense'); done.off = true; }
  if (!done.def && prompt === 'Pick a front, then call it') { await shot('#game', 'shot_defense'); done.def = true; }
  let pick = acts.filter((a) => a.startsWith('p:') || a.startsWith('d:') || a === 'pat');
  if (prompt.startsWith('4th') && acts.includes('punt')) pick = [acts.includes('fg') ? 'fg' : 'punt'];
  const a = done.off && !done.live && acts.includes('p:curls') ? 'p:curls' : pick[n % pick.length];
  await page.click(`#panel [data-act="${a}"]`);
  if (a === 'p:curls' && !done.live) { await sleep(2350); await shot('#stage', 'shot_live'); done.live = true; await page.evaluate(() => window.__fnd.setSpeed(0)); }
  await sleep(30);
  s = await waitChoose();
}
await sleep(300);
await shot('#final', 'shot_final');
console.log(JSON.stringify(done), JSON.stringify(s));
await browser.close();
