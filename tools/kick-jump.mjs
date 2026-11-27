// Measures the largest jump of any player between the last frame of a kick and the first frame of the return.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL('site/play/index.html').href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(400); await page.click('#title'); await sleep(150); await page.click('#goExhibition'); await page.click('[data-team="0"]');
await page.evaluate(() => { window.__fnd.setPlayClock(false); window.__fnd.setSpeed(1); });
const jumps = [];
let prev = null, prevMode = '';
for (let i = 0; i < 6000 && jumps.length < 4; i++) {
  const s = await page.evaluate(() => ({ st: window.__fnd.state(), view: window.__fnd.view ? window.__fnd.view() : null }));
  if (!s.view) { console.log('no view hook'); break; }
  if (prevMode === 'kick' && s.st.mode === 'return' && prev) {
    // For each player now, the distance to the nearest same-team player a frame ago.
    let worst = 0;
    for (const p of s.view) { let best = 1e9; for (const q of prev) if (q.team === p.team) best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y)); worst = Math.max(worst, best); }
    jumps.push({ worst: Number(worst.toFixed(1)), before: prev.length, after: s.view.length });
  }
  prev = s.view; prevMode = s.st.mode;
  if (s.st.mode === 'choose') {
    const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
    const pick = acts.includes('snap') ? 'snap' : acts.includes('k:deep') ? 'k:deep' : acts.includes('punt') ? 'punt' : acts.find((a) => a === 'pat' || a.startsWith('d:') || a.startsWith('p:'));
    if (pick) await page.click(`#panel [data-act="${pick}"]`).catch(() => {});
  }
  await sleep(8);
}
console.log(JSON.stringify({ jumps, errors }));
await browser.close();
