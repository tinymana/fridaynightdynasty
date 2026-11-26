// Captures the screenshots used on the website from the built game, as WebP via tools/site-shots.py afterwards.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const out = process.argv[2] ?? '/tmp/fnd-site-shots';
import { mkdirSync } from 'node:fs';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 1000, deviceScaleFactor: 1.5 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
const shot = async (sel, name) => { const el = await page.$(sel); await el.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const acts = () => page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
await page.goto(pathToFileURL('site/play/index.html').href);
await sleep(400);
await page.click('#title');
await sleep(150);

// Designer.
await page.click('#editBook');
await page.click('#newPlay');
await sleep(100);
await page.$eval('#dsName', (e) => { e.value = ''; });
await page.type('#dsName', 'Wildcat Special');
await page.click('#dsRun');
await sleep(300);
await shot('#designer', 'shot_designer');
await page.click('#dsCancel');
await page.click('#bookCancel').catch(() => {});
await page.evaluate(() => document.getElementById('bookScreen').classList.contains('hidden') || document.querySelector('#bookScreen .seg')?.click());
await page.reload();
await sleep(400);
await page.click('#title');
await sleep(150);

// Dynasty.
await page.select('#quarterPick', '4');
await page.click('#dynastyBtn');
await page.select('#dyState', 'TX');
await sleep(100);
await page.click('#dyBody [data-school="0"]');
for (let w = 0; w < 4; w++) { await page.click('#dySim'); for (let i = 0; i < 600 && (await st()).dynasty.week !== w + 1; i++) await sleep(100); await sleep(100); }
await shot('#dynasty', 'shot_dynasty');
await page.evaluate(() => localStorage.removeItem('fnd.dynasty.v1'));
await page.evaluate(() => localStorage.removeItem('fnd.setup.v1'));
await page.reload();
await sleep(400);
await page.click('#title');
await sleep(150);

// A game.
await page.click('[data-team="0"]');
await page.evaluate(() => window.__fnd.setPlayClock(false));
const done = { off: false, def: false, live: false, cut: false, kick: false };
for (let n = 0; n < 9000; n++) {
  const s = await st();
  if (s.mode === 'final') break;
  if (!done.cut && s.cutin === 'Touchdown') { await sleep(400); await shot('#stage', 'shot_cutin'); done.cut = true; await page.evaluate(() => window.__fnd.setSpeed(0)); }
  if (s.mode !== 'choose') { await sleep(40); continue; }
  const prompt = await page.$eval('#prompt', (e) => e.textContent);
  const a = await acts();
  if (!done.kick && a.includes('k:deep')) { await shot('#game', 'shot_kickoff'); done.kick = true; }
  if (!done.off && prompt === 'Call your play') { await shot('#game', 'shot_offense'); done.off = true; }
  if (!done.def && a.some((x) => x.startsWith('d:'))) { await shot('#game', 'shot_defense'); done.def = true; }
  let pick = a.filter((x) => x.startsWith('p:') || x.startsWith('d:') || x === 'pat' || x === 'k:deep');
  if (prompt.startsWith('4th') && a.includes('punt')) pick = [a.includes('fg') ? 'fg' : 'punt'];
  const want = done.off && !done.live && a.includes('p:curls') ? 'p:curls' : pick[n % pick.length];
  if (!want) { await sleep(40); continue; }
  await page.click(`#panel [data-act="${want}"]`).catch(() => {});
  if (want === 'p:curls' && !done.live) { await sleep(2350); await shot('#stage', 'shot_live'); done.live = true; await page.evaluate(() => window.__fnd.setSpeed(2)); }
  await sleep(40);
}
await sleep(400);
await shot('#final', 'shot_final');
console.log(JSON.stringify(done));
await browser.close();
