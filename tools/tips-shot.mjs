// Phone check of the first-game tips, press-and-hold play descriptions and the coach's own game book. Run: node tools/tips-shot.mjs
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const errors = []; const facts = { tips: [] };
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) errors.push(`check failed: ${name}`); };
await page.goto(pathToFileURL('site/play/index.html').href + '?lowres');
await sleep(400); await page.click('#title'); await sleep(150);
await page.evaluate(() => window.__fnd.tips(true));
await page.click('#goExhibition'); await sleep(150); await page.select('#quarterPick', '4'); await page.click('[data-team="0"]');
let held = false;
for (let i = 0; i < 2500 && (facts.tips.length < 4 || !held); i++) {
  const s = await st();
  if (s.mode !== 'choose') { await sleep(40); continue; }
  const tip = await page.$eval('#coachTip', (e) => (e.classList.contains('hidden') ? '' : e.querySelector('b').textContent));
  if (tip) {
    if (!facts.tips.includes(tip)) { facts.tips.push(tip); await page.screenshot({ path: `/tmp/fnd-shots/tip-${facts.tips.length}.png` }); }
    await page.click('#tipOk'); await sleep(60); continue;
  }
  const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
  const play = acts.find((a) => a.startsWith('p:'));
  if (play && !held) {
    const el = await page.$(`#panel [data-act="${play}"]`);
    const b = await el.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await sleep(600);
    const shown = await page.$eval('#cardTip', (e) => (e.classList.contains('hidden') ? '' : e.textContent));
    await page.screenshot({ path: '/tmp/fnd-shots/tip-hold.png' });
    await page.mouse.up(); await sleep(100);
    check('holding a play shows what it does', shown.length > 30);
    check('letting go of a held play does not call it', (await st()).mode === 'choose' && (await page.$(`#panel [data-act="${play}"]`)) !== null);
    facts.hold = shown.slice(0, 120);
    held = true; continue;
  }
  const pick = acts.includes('snap') ? 'snap' : acts.find((a) => a.startsWith('k:')) ?? play ?? acts.find((a) => a.startsWith('d:')) ?? acts.find((a) => a === 'pat');
  if (pick) await page.evaluate((a) => document.querySelector(`#panel [data-act="${a}"]`)?.click(), pick);
  await sleep(40);
}
check('a tip for each kind of call', facts.tips.length >= 4);
console.log(JSON.stringify({ facts, errors }, null, 1));
await browser.close();
