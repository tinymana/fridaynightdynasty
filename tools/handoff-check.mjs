// Runs should look like runs: on a run the quarterback turns and hands off and never sets up to throw. Run: node tools/handoff-check.mjs
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL('site/play/index.html').href + '?lowres');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500); await page.click('#title'); await sleep(150); await page.click('#goExhibition'); await page.click('[data-team="0"]');
await page.evaluate(() => {
  window.__fnd.setPlayClock(false); window.__fnd.setSpeed(1);
  // Sample the drawn players every frame while a play is live.
  window.__seen = { poses: {}, turned: 0, handing: 0 };
  const tick = () => {
    const s = window.__fnd.state();
    if (s.mode === 'live') for (const p of window.__fnd.view() ?? []) {
      if (p.pose) window.__seen.poses[p.pose] = (window.__seen.poses[p.pose] ?? 0) + 1;
      if (p.back && p.ball) window.__seen.turned++;
      if (p.back && p.pose === 'handoff') window.__seen.handing++;
    }
    requestAnimationFrame(tick);
  };
  tick();
});
const results = [];
let last = '';
for (let i = 0; i < 4000 && results.length < 6; i++) {
  const s = await page.evaluate(() => window.__fnd.state());
  if (s.mode === 'choose') {
    const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
    if (acts.includes('snap')) { await page.evaluate(() => { window.__seen = { poses: {}, turned: 0, handing: 0 }; }); await page.click('#panel [data-act="snap"]'); last = 'snap'; }
    else {
      const pick = acts.find((a) => a.startsWith('k:')) ?? acts.find((a) => a.startsWith('p:') && /dive|iso|power|sweep|counter/i.test(a)) ?? acts.find((a) => a.startsWith('d:')) ?? acts.find((a) => a === 'pat') ?? acts.find((a) => a.startsWith('p:'));
      if (pick) { await page.click(`#panel [data-act="${pick}"]`).catch(() => {}); if (pick.startsWith('p:')) last = pick; }
    }
  } else if (s.mode === 'post' && last === 'snap') {
    const text = await page.$eval('#banner', (e) => e.textContent);
    const seen = await page.evaluate(() => window.__seen);
    results.push({ text: text.slice(0, 50), ...seen });
    last = '';
  }
  await sleep(30);
}
const runs = results.filter((r) => / runs? /.test(r.text));
for (const r of results) console.log(JSON.stringify(r));
const ok = runs.length > 0 && runs.every((r) => !r.poses.throw0 && r.handing > 0 && r.turned > 0);
console.log(`${ok ? 'PASS' : 'FAIL'}  on ${runs.length} runs the quarterback turned, handed off and never set to throw`);
console.log(errors.length ? `errors: ${errors.join('; ')}` : 'errors: none');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
