// Photographs the exhibition and Play Online pages, the lobby, the coin toss and the line of scrimmage at phone and desk size.
// Run: node tools/menus-shot.mjs [outDir]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const PORT = 8793;
const server = spawn('npx', ['tsx', 'tools/mock-online.ts', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-web-security'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const facts = {};
for (const [tag, vp] of [['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['desk', { width: 1100, height: 900 }]]) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport(vp);
  await page.evaluateOnNewDocument((url) => { window.__fndOnlineUrl = url; }, `http://localhost:${PORT}`);
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  const shot = (n) => page.screenshot({ path: `${out}/mn-${tag}-${n}.png`, fullPage: true });
  const st = () => page.evaluate(() => window.__fnd.state());
  await page.goto(`${pathToFileURL('site/play/index.html').href}?lowres`);
  await sleep(400); await page.click('#title'); await sleep(200);
  await page.click('#goExhibition'); await sleep(200);
  await page.select('#exPick0 .sp-state', 'TX'); await sleep(100);
  await page.select('#exPick0 .sp-school', '3'); await sleep(100);
  await page.select('#exPick1 .sp-state', 'OH'); await sleep(100);
  await shot('exhibition');
  facts[`${tag} cards`] = await page.$$eval('#teams .nm', (e) => e.map((x) => x.textContent));
  // The coin toss and the line.
  await page.evaluate(() => window.__fnd.toss(true));
  await page.click('[data-team="1"]'); await sleep(500);
  await shot('toss-call');
  await page.click('#panel [data-act="toss:heads"]'); await sleep(400);
  await shot('toss-result');
  facts[`${tag} toss`] = await page.$eval('#banner', (e) => e.textContent);
  let line = false;
  for (let i = 0; i < 3000 && !line; i++) {
    const s = await st();
    if (s.mode !== 'choose') { await sleep(40); continue; }
    const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
    if (acts.includes('snap')) {
      await sleep(150); await shot('line');
      facts[`${tag} line acts`] = acts;
      if (acts.includes('aud')) { await page.click('#panel [data-act="aud"]'); await sleep(150); await shot('line-audible'); }
      line = true; break;
    }
    const pick = acts.find((a) => a.startsWith('toss:')) ?? acts.find((a) => a.startsWith('k:')) ?? acts.filter((a) => a.startsWith('p:')).pop() ?? acts.find((a) => a.startsWith('d:')) ?? acts.find((a) => a === 'pat');
    if (pick) await page.evaluate((a) => document.querySelector(`#panel [data-act="${a}"]`)?.click(), pick);
    await sleep(40);
  }
  facts[`${tag} reached line`] = line;
  // Online.
  await page.reload(); await sleep(400); await page.click('#title'); await sleep(200);
  await page.click('#goOnline'); await sleep(200);
  await shot('online-out');
  await page.type('#oName', tag === 'phone' ? 'PHONE' : 'DESK'); await page.type('#oPin', '1234'); await page.click('#oEnter');
  await page.waitForSelector('#oSignedIn:not(.hidden)'); await sleep(300);
  await page.select('#oSchool .sp-state', 'GA'); await sleep(150);
  await page.select('#oSchool .sp-school', '5'); await sleep(150);
  await shot('online-in');
  facts[`${tag} sideways`] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  facts[`${tag} small targets`] = await page.$$eval('#onlineBox button, #onlineBox input, #onlineBox select', (els) => els.filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height < 40; }).map((e) => e.id || e.className));
  await page.click('#oHost'); await page.waitForSelector('#lobby:not(.hidden)'); await sleep(300);
  await shot('lobby');
  facts[`${tag} lobby`] = await page.$$eval('#lobbySeats .nm', (e) => e.map((x) => x.textContent));
}
console.log(JSON.stringify({ facts, errors }, null, 1));
await browser.close();
server.kill();
