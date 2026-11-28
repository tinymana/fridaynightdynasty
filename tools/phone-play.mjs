// A playthrough at phone size: plays an exhibition game by tapping, photographs each kind of screen once, and measures
// how far a coach has to scroll and how long he waits. Run: node tools/phone-play.mjs [plays]
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const MAX = Number(process.argv[2] ?? 14);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
const shot = (n) => page.screenshot({ path: `/tmp/fnd-shots/pp-${n}.png` });
await page.goto(pathToFileURL('site/play/index.html').href + '?lowres');
await sleep(500); await page.tap('#title'); await sleep(200);
await page.tap('#goExhibition'); await sleep(200); await page.select('#quarterPick', '4'); await shot('setup');
await page.tap('[data-team="0"]'); await sleep(600);
const seen = new Set(); const facts = { calls: [], waits: [] };
let plays = 0, lastMode = '', tChoose = 0;
for (let i = 0; i < 6000 && plays < MAX; i++) {
  const s = await st();
  if (s.mode !== lastMode) { if (s.mode === 'choose' && tChoose) facts.waits.push(Date.now() - tChoose); lastMode = s.mode; }
  if (s.mode === 'choose') {
    const info = await page.evaluate(() => {
      const acts = [...document.querySelectorAll('#panel [data-act]')];
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight; };
      const small = acts.filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.height < 40 || b.width < 40); }).length;
      return { acts: acts.map((e) => e.dataset.act), onScreen: acts.filter(vis).length, total: acts.length, small, page: document.documentElement.scrollHeight, view: window.innerHeight, scrollY: window.scrollY, panelTop: Math.round(document.querySelector('#panel').getBoundingClientRect().top) };
    });
    const kind = info.acts.includes('snap') ? 'line' : info.acts.some((a) => a.startsWith('k:')) ? 'kick' : info.acts.some((a) => a.startsWith('d:')) ? 'defense' : info.acts.some((a) => a.startsWith('p:')) ? 'offense' : info.acts.join(',').slice(0, 30);
    if (!seen.has(kind)) { seen.add(kind); await shot(`call-${kind.replace(/[^a-z]/g, '')}`); facts.calls.push({ kind, ...info, acts: info.acts.length }); }
    const pick = info.acts.includes('snap') ? 'snap' : info.acts.find((a) => a.startsWith('k:')) ?? info.acts.find((a) => a.startsWith('p:')) ?? info.acts.find((a) => a.startsWith('d:')) ?? info.acts.find((a) => a === 'pat') ?? info.acts[0];
    if (pick) { await page.evaluate((a) => document.querySelector(`#panel [data-act="${a}"]`)?.click(), pick); if (pick.startsWith('p:') || pick.startsWith('d:')) { plays++; tChoose = Date.now(); } }
  } else if (s.mode === 'live' && !seen.has('live')) { seen.add('live'); await sleep(500); await shot('live'); }
  else if (s.mode === 'post' && !seen.has('post')) { seen.add('post'); await sleep(300); await shot('post'); }
  await sleep(40);
}
const wait = facts.waits.length ? Math.round(facts.waits.reduce((a, b) => a + b, 0) / facts.waits.length / 100) / 10 : 0;
console.log(JSON.stringify({ plays, secondsFromCallToNextCall: wait, calls: facts.calls, errors }, null, 1));
await browser.close();
