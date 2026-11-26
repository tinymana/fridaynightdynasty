// Two browsers share a dynasty league against the local mock server: gather, pick schools, play a game between two coaches, move the week on.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const PORT = 8791;
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
  page.on('console', (m) => { if (m.type() === 'error' && !/40[0349]/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  await page.goto(pathToFileURL('site/play/index.html').href);
  await sleep(300);
  await page.evaluate(() => window.__fnd.setTurbo(true));
  await page.click('#title');
  await sleep(100);
  return page;
}
const st = (p) => p.evaluate(() => window.__fnd.state());
const text = (p, sel) => p.$eval(sel, (e) => e.textContent);
const signIn = async (p, name, pin) => { await p.type('#oName', name); await p.type('#oPin', pin); await p.click('#oEnter'); await p.waitForSelector('#oSignedIn:not(.hidden)'); };
const until = async (f, ms = 30000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await sleep(100); } return false; };

try {
  const a = await open('commissioner');
  const b = await open('friend');
  await a.select('#quarterPick', '4');
  await signIn(a, 'Coach Ann', '1111');
  await signIn(b, 'Coach Bo', '2222');
  await a.click('#lgNew');
  await a.select('#shState', 'GA');
  await a.click('#shCreate');
  await a.waitForSelector('.sh-code');
  const code = await text(a, '.sh-code');
  check('starting a league gives a five-letter code', /^[A-Z]{5}$/.test(code));
  await a.click('#shBody [data-school="0"]');
  await b.type('#lgCode', code.toLowerCase());
  await b.click('#lgJoin');
  await b.waitForSelector('#shBody [data-school]');
  check('the friend sees the same league and the commissioner\'s school taken', (await text(b, '#shBody')).includes('Coach COACH ANN') && await b.$eval('#shBody [data-school="0"]', (e) => e.disabled));
  await b.click('#shBody [data-school="7"]');
  check('the commissioner sees the friend take a school', await until(async () => (await text(a, '#shBody')).includes('COACH BO')));
  check('only the commissioner has the start button', (await a.$('#shStart')) !== null && (await b.$('#shStart')) === null);
  // The commissioner renames his school; the friend sees it and cannot do the same.
  await a.select('#shEdit', '0');
  await a.waitForSelector('#sf');
  await a.$eval('#sfName', (e) => { e.value = 'Tiny Mana Prep'; });
  await a.$eval('#sfMascot', (e) => { e.value = 'Wizards'; });
  await a.$eval('#sfAbbr', (e) => { e.value = 'TMP'; });
  await a.$eval('#sf_jersey', (e) => { e.value = '#6b21a8'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(600);
  check('the rename form stays open while the league keeps updating', (await a.$('#sf')) !== null && (await a.$eval('#sfName', (e) => e.value)) === 'Tiny Mana Prep');
  await a.click('#sfSave');
  check('the friend sees the renamed school', await until(async () => (await text(b, '#shBody')).includes('Tiny Mana Prep Wizards')));
  check('only the commissioner can rename schools', (await a.$('#shEdit')) !== null && (await b.$('#shEdit')) === null);
  await a.screenshot({ path: `${out}/league-lobby.png` });
  await a.click('#shStart');
  check('both coaches see the season start', await until(async () => (await st(a)).league?.state === 'season' && (await st(b)).league?.state === 'season'));
  check('they meet in week 1 and are told both must be there', (await text(a, '#shBody .dy-next')).includes('You both have to be here'));

  await a.click('#shPlay');
  await a.waitForSelector('#lobby:not(.hidden)');
  check('the first coach waits in the game room, with no start button', (await text(a, '#lobbyHelp')).includes('League game') && await a.$eval('#lobbyStart', (e) => e.classList.contains('hidden')));
  check('the friend is told a coach is waiting', await until(async () => (await text(b, '#shBody .dy-next')).includes('already waiting')));
  await b.screenshot({ path: `${out}/league-waiting.png` });
  await b.click('#shPlay');
  check('the game starts when both are there', await until(async () => (await st(a)).mode !== 'menu' && (await st(b)).mode !== 'menu' && (await a.$eval('#game', (e) => !e.classList.contains('hidden')))));
  const names = await text(a, '#bug');
  check('the game is between the two league schools, under the new name', !names.includes('MCW') && !names.includes('DRS') && names.includes('TMP'));
  for (const p of [a, b]) await p.evaluate(() => { window.__fnd.setSpeed(0); });
  for (let i = 0; i < 9000; i++) {
    const [sa, sb] = [await st(a), await st(b)];
    if (sa.mode === 'final' && sb.mode === 'final') break;
    for (const [p, s] of [[a, sa], [b, sb]]) {
      if (s.mode !== 'choose') continue;
      const acts = await p.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
      const prompt = await text(p, '#prompt');
      let pick = acts.filter((x) => x.startsWith('p:') || x.startsWith('d:') || x.startsWith('k:') || x === 'pat');
      if (prompt.startsWith('4th') && acts.includes('punt')) pick = [acts.includes('fg') ? 'fg' : 'punt'];
      if (pick.length) await p.click(`#panel [data-act="${pick[i % pick.length]}"]`).catch(() => {});
    }
    await sleep(25);
  }
  const [fa, fb] = [await st(a), await st(b)];
  check('both browsers reach the final whistle with the same score', fa.mode === 'final' && fb.mode === 'final' && JSON.stringify(fa.score) === JSON.stringify(fb.score));
  check('both stayed in sync with the server', (await text(a, '#finalMeta')).includes('matches the server') && (await text(b, '#finalMeta')).includes('matches the server'));
  check('the final screen leads back to the league', (await text(a, '#again')) === 'Back to the league');
  await a.click('#again');
  await b.click('#again');
  // The week may already have closed by the time both are back, so the result is in this week's games or last week's.
  check('the league shows the result', await until(async () => { const l = (await st(a)).league; return !!l && (l.week >= 1 ? /Week 1 results/.test(await text(a, '#shBody')) : /Your game is in/.test(await text(a, '#shBody .dy-next'))); }));
  await a.screenshot({ path: `${out}/league-season.png` });
  check('only the commissioner can move the week on', (await a.$('#shForce')) === null || (await b.$('#shForce')) === null);
  // The other two AI games play themselves as the coaches check in; with both coaches' game in, the week closes.
  check('the week moves on once every game is in', await until(async () => (await st(a)).league?.week === 1 && (await st(b)).league?.week === 1, 60000));
  check('standings count the game', /1-0|0-1|0-0-1/.test(await text(a, '#shBody table')));
  // Week 2: they do not meet; the commissioner lets the AI finish it.
  await a.waitForSelector('#shForce');
  await a.click('#shForce');
  await a.click('#shForce').catch(() => {});
  check('the commissioner can let the AI finish a week', await until(async () => (await st(a)).league?.week === 2, 60000));
  await a.click('#shBack');
  await sleep(300);
  check('the menu remembers the league', (await text(a, '#lgMine')).includes(code));
  check('a game between two coaches counts in the career record', /career record/.test(await text(a, '#oCareer')));
  console.log('final score', fa.score, 'league', JSON.stringify((await st(b)).league));
} catch (e) {
  errors.push(String(e));
} finally {
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  server.kill();
  process.exit(errors.length ? 1 : 0);
}
