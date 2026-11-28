// A phone-width sweep: opens every main page at 390 px and reports any that scroll sideways or hold an element wider than the screen.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
const report = [];
async function look(name) {
  await sleep(150);
  const r = await page.evaluate(() => {
    const w = window.innerWidth;
    const wide = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.right > w + 2 || b.left < -2) && getComputedStyle(e).position !== 'fixed' && !e.closest('.gb-body') && !e.closest('#stage') && !e.closest('.fronts'); }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).split(' ')[0]} ${Math.round(e.getBoundingClientRect().right)}`);
    return { scroll: document.documentElement.scrollWidth, w, wide };
  });
  await page.screenshot({ path: `/tmp/fnd-shots/phone-${name}.png` });
  report.push({ name, ok: r.scroll <= r.w + 1 && r.wide.length === 0, ...r });
}
await page.goto(pathToFileURL('site/play/index.html').href + '?lowres');
await sleep(500); await look('title');
await page.click('#title'); await look('menu');
await page.click('#goSaves'); await look('saves');
await page.click('.page[data-page="saves"] [data-menu]');
await page.click('#goOnline'); await look('online');
await page.click('.page[data-page="online"] [data-menu]');
await page.click('#editBook'); await look('playbook');
await page.evaluate(() => document.querySelector('#bookScreen button')?.scrollIntoView());
await page.reload(); await sleep(500); await page.click('#title'); await sleep(150);
await page.click('#goExhibition'); await page.select('#quarterPick', '4'); await look('exhibition');
await page.click('#mainMenu', { delay: 1 }).catch(() => {});
await page.click('.page[data-page="exhibition"] [data-menu]');
await page.click('#dynastyBtn'); await page.select('#dyState', 'OH'); await look('dynasty-new');
const job = await page.$eval('#dyBody .job [data-school]', (e) => e.dataset.school);
await page.click(`#dyBody [data-school="${job}"]`); await look('dynasty-season');
await page.click('#dySim'); for (let t = 0; t < 600 && (await st()).dynasty.week !== 1; t++) await sleep(100);
await look('dynasty-week2');
await page.click('#dyPaper'); await sleep(1200); await look('paper'); await page.click('#dyHome');
await page.click('#dyBody [data-book]'); await sleep(300); await look('book-summary');
for (const tab of ['box', 'drives', 'plays']) { await page.click(`#dyBook [data-gb="${tab}"]`); await look(`book-${tab}`); }
await page.click('#bkBack');
await page.click('#dyProgram'); await look('program'); await page.click('#dyHome');
await page.click('#dyStats'); await look('stats'); await page.click('#dyHome').catch(() => {});
await page.evaluate(() => document.querySelector('#dyPlay')?.click()); await sleep(4500); await look('game-kick');
for (let i = 0; i < 400; i++) { const s = await st(); if (s.mode === 'choose') { const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act)); if (acts.some((a) => a.startsWith('p:') || a.startsWith('d:'))) break; const k = acts.find((a) => a.startsWith('k:')); if (k) await page.click(`#panel [data-act="${k}"]`); } await sleep(60); }
await look('game-call');
for (const r of report) console.log(`${r.ok ? 'ok  ' : 'WIDE'} ${r.name.padEnd(16)} page ${r.scroll}/${r.w} ${r.wide.join(' | ')}`);
console.log(errors.length ? `errors: ${errors.join('; ')}` : 'errors: none');
await browser.close();
