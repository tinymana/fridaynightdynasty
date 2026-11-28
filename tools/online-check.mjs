// Two browsers play a whole online game against the local mock server (the real API code, in-memory storage).
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const PORT = 8790;
const server = spawn('npx', ['tsx', 'tools/mock-online.ts', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-web-security'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) errors.push(`check failed: ${name}`); };
async function open(tag) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1000, height: 1000 });
  await page.evaluateOnNewDocument((url) => { window.__fndOnlineUrl = url; }, `http://localhost:${PORT}`);
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  // A call that arrives after the final whistle is refused; that is expected. Any other refusal is reported.
  page.on('response', async (r) => { if (r.status() !== 400) return; const body = await r.text().catch(() => ''); if (!body.includes('not_playing')) errors.push(`${tag}: refused ${r.request().postData()} ${body}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !/40[049]/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  await page.goto(`${pathToFileURL('site/play/index.html').href}?lowres`);
  await sleep(300);
  await page.evaluate(() => window.__fnd.setTurbo(true));
  await page.click('#title');
  await sleep(100);
  return page;
}
const st = (p) => p.evaluate(() => window.__fnd.state());
const signIn = async (p, name, pin) => { await p.click('#goOnline').catch(() => {}); await p.type('#oName', name); await p.type('#oPin', pin); await p.click('#oEnter'); await p.waitForSelector('#oSignedIn:not(.hidden)'); };

try {
  const a = await open('host');
  const b = await open('guest');
  // The guest brings a play and a defense of his own design.
  await b.click('#editBook');
  await b.click('#newPlay');
  await b.click('#dsSave');
  await b.click('#newDef');
  await b.click('#dsSave');
  const mineId = (await b.$eval('.mine [data-act]', (e) => e.dataset.act)).slice(2);
  await b.click('[data-act="b:toss"]');
  await b.click(`[data-act="b:${mineId}"]`);
  await b.click('#bookSave');
  await b.click('#hallBtn');
  await sleep(400);
  check('the Hall of Fame starts empty', (await b.$eval('#hallBody', (e) => e.textContent)).includes('No finished online games'));
  await b.click('#hallBack');
  await signIn(a, 'Coach Ann', '1111');
  await signIn(b, 'coach bo', '2222');
  await a.click('#oHost');
  await a.waitForSelector('#lobby:not(.hidden)');
  const pin = await a.$eval('#lobbyPin', (e) => e.textContent);
  check('host sees a five-digit game PIN', /^[0-9]{5}$/.test(pin));
  await a.screenshot({ path: `${out}/online-lobby-waiting.png` });
  // A wrong PIN is refused with a message.
  await b.type('#oJoinPin', '00000');
  await b.click('#oJoin');
  await sleep(300);
  check('a wrong game PIN shows a message', (await b.$eval('#oMsg', (e) => e.textContent)).length > 0);
  await b.$eval('#oJoinPin', (e) => { e.value = ''; });
  await b.type('#oJoinPin', pin);
  await b.click('#oJoin');
  await b.waitForSelector('#lobby:not(.hidden)');
  await sleep(1500);
  check('host sees the guest arrive', (await a.$eval('#lobbySeats', (e) => e.textContent)).includes('COACH BO'));
  check('guest has no start button', await b.$eval('#lobbyStart', (e) => e.classList.contains('hidden')));
  await a.screenshot({ path: `${out}/online-lobby-ready.png` });
  await a.click('#lobbyStart');
  await a.waitForSelector('#game:not(.hidden)');
  await b.waitForSelector('#game:not(.hidden)');
  for (const p of [a, b]) await p.evaluate(() => window.__fnd.setSpeed(0));

  let shot = false, rejoined = false, plays = 0, ownPlay = 0, ownDef = 0, blocks = 0, snaps = 0, audibles = 0;
  let pages = [a, b];
  for (let i = 0; i < 6000; i++) {
    const states = await Promise.all(pages.map(st));
    if (states.every((s) => s.mode === 'final')) break;
    if (process.env.FND_DEBUG && i % 150 === 0) console.log('dbg', i, Date.now() % 1000000, plays, states.map((x) => `${x.mode}/${x.online?.turn}/${x.online?.sync}`).join(' '));
    for (let k = 0; k < 2; k++) {
      const s = states[k];
      if (s.mode !== 'choose') continue;
      const p = pages[k];
      const prompt = await p.$eval('#prompt', (e) => e.textContent);
      const acts = await p.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
      let pick = acts.filter((x) => x === 'snap' || x.startsWith('a:') || x.startsWith('p:') || x.startsWith('d:') || x.startsWith('m:') || x.startsWith('k:') || x === 'pat');
      if (acts.includes('aud') && !acts.some((x) => x.startsWith('a:')) && i % 2 === 0) { await p.click('#panel [data-act="aud"]').catch(() => {}); continue; }
      if (acts.includes('block') && i % 4 === 0) { await p.click('#panel [data-act="block"]').catch(() => {}); blocks++; continue; }
      if (acts.includes('f:@custom') && i % 3 === 0) { await p.click('#panel [data-act="f:@custom"]').catch(() => {}); continue; }
      if (acts.includes('tab:@mine') && !acts.includes(`p:${mineId}`) && i % 2 === 0) { await p.click('#panel [data-act="tab:@mine"]').catch(() => {}); continue; }
      if (acts.includes(`p:${mineId}`) && i % 2 === 0) pick = [`p:${mineId}`];
      const tabsHere = acts.filter((x) => x.startsWith('tab:'));
      if (tabsHere.length && i % 5 === 1) { await p.click(`#panel [data-act="${tabsHere[(i >> 2) % tabsHere.length]}"]`).catch(() => {}); continue; }
      if (prompt.startsWith('4th') && acts.includes('punt')) pick = [acts.includes('fg') ? 'fg' : 'punt'];
      if (!pick.length) continue;
      const chosen = pick[(i + k) % pick.length];
      await p.click(`#panel [data-act="${chosen}"]`).catch(() => {});
      plays++;
      if (chosen === `p:${mineId}`) ownPlay++;
      if (chosen === 'snap') snaps++;
      if (chosen.startsWith('a:')) audibles++;
      if (chosen.startsWith('m:')) ownDef++;
      if (!shot && k === 0) { await sleep(150); await p.screenshot({ path: `${out}/online-waiting.png` }); shot = true; }
    }
    // Part way through, the guest closes his browser and comes back on a "new device".
    if (!rejoined && plays > 30) {
      rejoined = true;
      await b.close();
      const c = await open('guest-again');
      await signIn(c, 'COACH BO', '2222');
      await c.type('#oJoinPin', pin);
      await c.click('#oJoin');
      await c.waitForSelector('#game:not(.hidden)');
      await c.evaluate(() => window.__fnd.setSpeed(0));
      pages = [a, c];
      check('guest rejoins the game in progress', (await st(c)).online?.state === 'playing');
    }
    await sleep(25);
  }
  await sleep(1500);
  const [sa, sb] = await Promise.all(pages.map(st));
  check('both browsers reach the final whistle', sa.mode === 'final' && sb.mode === 'final');
  check('both browsers show the same score', JSON.stringify(sa.score) === JSON.stringify(sb.score));
  check('browsers match the server score', JSON.stringify(sa.score) === JSON.stringify(sa.online.serverScore));
  check('host stayed in sync all game', sa.online.sync === 'ok' && sa.online.localHash === sa.online.serverHash);
  check('rejoined guest is in sync', sb.online.sync === 'ok' && sb.online.localHash === sb.online.serverHash);
  check('final screen says it matches the server', (await pages[0].$eval('#finalMeta', (e) => e.textContent)).includes('matches the server'));
  await pages[0].screenshot({ path: `${out}/online-final.png` });
  console.log('final score', sa.score, 'calls made', plays, 'designed plays called', ownPlay, 'designed defenses called', ownDef, 'block toggles', blocks);
  check('designed plays and defenses were called online', ownPlay > 3 && ownDef > 3);
  console.log('snaps at the line', snaps, 'audibles', audibles);
  check('both coaches went to the line and audibled online', snaps > 5 && audibles > 5);
  // Careers and the Hall of Fame.
  await sleep(3200);
  const want = (mine, theirs) => (mine > theirs ? '1-0' : mine < theirs ? '0-1' : '0-0-1');
  const fa = await pages[0].$eval('#finalCareer', (e) => e.textContent);
  const fb = await pages[1].$eval('#finalCareer', (e) => e.textContent);
  check('host final screen shows his career record', fa.includes('COACH ANN') && fa.includes(want(sa.score[0], sa.score[1])));
  check('guest final screen shows his career record', fb.includes('COACH BO') && fb.includes(want(sa.score[1], sa.score[0])));
  await pages[0].click('#again');
  await sleep(600);
  check('the sign-in box shows the career record', (await pages[0].$eval('#oCareer', (e) => e.textContent)).includes('career record'));
  await pages[0].click('#hallBtn2');
  await sleep(500);
  const hall = await pages[0].$eval('#hallBody', (e) => e.textContent);
  check('both coaches are in the Hall of Fame', hall.includes('COACH ANN') && hall.includes('COACH BO'));
  check('the Hall of Fame has one row per coach', (await pages[0].$$eval('#hallBody tr', (r) => r.length)) === 3);
  await pages[0].screenshot({ path: `${out}/hall.png` });
  console.log('   hall:', hall.replace(/\s+/g, ' '));
} catch (e) {
  errors.push(String(e));
} finally {
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  server.kill();
  process.exit(errors.length ? 1 : 0);
}
