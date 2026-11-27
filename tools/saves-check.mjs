// Permanent saves in headless Chrome against the local mock server: a dynasty saved on one device shows up on another,
// an older copy never overwrites a newer one without asking, and a save file can be downloaded and loaded back.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
const dl = '/tmp/fnd-saves-dl';
rmSync(dl, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(dl, { recursive: true });
const PORT = 8793;
const server = spawn('npx', ['tsx', 'tools/mock-online.ts', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-web-security'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) errors.push(`check failed: ${name}`); };
const waitFor = async (f, ms = 15000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await sleep(100); } return false; };
async function device(tag) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1000, height: 1100 });
  await page.evaluateOnNewDocument((url) => { window.__fndOnlineUrl = url; }, `http://localhost:${PORT}`);
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/40[019]/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  const start = async () => { await page.goto(`${pathToFileURL('site/play/index.html').href}?lowres`); await sleep(300); await page.evaluate(() => window.__fnd.setTurbo(true)); await page.click('#title'); await sleep(150); };
  await start();
  return { page, start, ctx };
}
const st = (p) => p.evaluate(() => window.__fnd.state());
const text = (p, sel) => p.$eval(sel, (e) => e.textContent);
const newDynasty = async (p, state) => {
  await p.click('#dynastyBtn');
  await p.select('#dyState', state);
  await sleep(100);
  const job = await p.$eval('#dyBody .job [data-school]', (e) => e.dataset.school);
  await p.click(`#dyBody [data-school="${job}"]`);
  await sleep(150);
  await p.click('#dyBack');
  await sleep(100);
};
const signIn = async (p, name, pin) => { await p.click('#goSaves'); await p.type('#svName', name); await p.type('#svPin', pin); await p.click('#svEnter'); await p.waitForSelector('#svIn:not(.hidden)'); };
const saved = (p) => waitFor(async () => (await text(p, '#svCloud')).includes('Saved '));

try {
  // Device A: a new dynasty, then sign in. The save goes up by itself.
  const a = await device('A');
  check('the menu says a save lives only in this browser', (await text(a.page, '#savesLine')).includes('another device'));
  await newDynasty(a.page, 'OH');
  check('with a dynasty and no sign-in, the menu says it is in this browser only', (await text(a.page, '#savesLine')).includes('this browser only'));
  await signIn(a.page, 'COACH S', '4321');
  check('signing in saves the dynasty to the server', await saved(a.page));
  const mine = (await st(a.page)).dynasty;
  await a.page.screenshot({ path: `${out}/saves-page.png` });

  // Device B: empty. Signing in brings the dynasty down.
  const b = await device('B');
  await signIn(b.page, 'COACH S', '4321');
  check('a second device gets the dynasty on signing in', await waitFor(async () => { const s = await st(b.page); return !!s.dynasty && s.dynasty.user === mine.user; }));
  check('and shows the same school', (await text(b.page, '#svLocal')) === (await text(a.page, '#svLocal')));
  // Play a week on B; it saves by itself.
  await b.page.click('.page[data-page="saves"] [data-menu]');
  await b.page.click('#dynastyBtn');
  await b.page.click('#dySim');
  await waitFor(async () => (await st(b.page)).dynasty.week === 1, 60000);
  await b.page.click('#dyBack');
  check('a week played on the second device is saved without being asked', await waitFor(async () => (await text(b.page, '#savesLine')).includes('Saved to the server')));

  // Device A again, later: reopening the game picks up the newer save.
  await a.start();
  check('the first device picks up the newer save when the game is opened', await waitFor(async () => (await st(a.page)).dynasty?.week === 1));

  // Device C has a dynasty of its own. Signing in must ask, not overwrite either one.
  const c = await device('C');
  await newDynasty(c.page, 'TX');
  const cUser = (await st(c.page)).dynasty;
  await signIn(c.page, 'COACH S', '4321');
  check('a device with its own dynasty is asked which to keep', await waitFor(async () => !(await c.page.$eval('#svAsk', (e) => e.classList.contains('hidden')))) && (await text(c.page, '#svAskText')).includes('Which one'));
  check('nothing is replaced while it waits', (await st(c.page)).dynasty.week === cUser.week && (await text(c.page, '#svLocal')).includes('week 1'));
  await c.page.screenshot({ path: `${out}/saves-choose.png` });
  await c.page.click('#svYes');
  check('choosing the server save loads it', await waitFor(async () => (await st(c.page)).dynasty?.week === 1 && (await st(c.page)).dynasty.user === mine.user));
  check('and the device then counts as saved', await saved(c.page));

  // Device D keeps its own instead: the server takes D's.
  const d = await device('D');
  await newDynasty(d.page, 'FL');
  const dLocal = (await st(d.page)).dynasty;
  await signIn(d.page, 'COACH S', '4321');
  await waitFor(async () => !(await d.page.$eval('#svAsk', (e) => e.classList.contains('hidden'))));
  await d.page.click('#svNo');
  check('keeping this browser’s save sends it to the server', await saved(d.page) && (await st(d.page)).dynasty.user === dLocal.user && (await st(d.page)).dynasty.week === 0);
  await b.start();
  check('and the other devices follow', await waitFor(async () => (await st(b.page)).dynasty?.week === 0));

  // A wrong PIN gets nothing.
  const e = await device('E');
  await e.page.click('#goSaves'); await e.page.type('#svName', 'COACH S'); await e.page.type('#svPin', '0000'); await e.page.click('#svEnter');
  check('a wrong PIN is refused and loads nothing', await waitFor(async () => (await text(e.page, '#svMsg')).includes('PIN')) && !(await st(e.page)).dynasty);

  // A save file: download on D, load on a device that has never signed in.
  const cdp = await d.page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, browserContextId: d.ctx.id });
  await d.page.click('#svDown');
  check('a save file downloads', await waitFor(() => readdirSync(dl).some((f) => f.endsWith('.json'))));
  const file = `${dl}/${readdirSync(dl).find((f) => f.endsWith('.json'))}`;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  check('the file is a save with the dynasty in it', parsed.fnd === 'save' && parsed.v === 1 && parsed.dynasty && parsed.dynasty.user === dLocal.user);
  await e.page.reload(); await sleep(300); await e.page.click('#title'); await sleep(150); await e.page.click('#goSaves');
  await (await e.page.$('#svFile')).uploadFile(file);
  check('loading the file on a fresh device restores the dynasty', await waitFor(async () => (await st(e.page)).dynasty?.user === dLocal.user) && (await text(e.page, '#svMsg')).startsWith('Loaded'));
  await (await e.page.$('#svFile')).uploadFile('package.json');
  check('a file that is not a save is refused', await waitFor(async () => (await text(e.page, '#svMsg')).includes('not a Friday Night Dynasty save')) && (await st(e.page)).dynasty.user === dLocal.user);
  await e.page.reload(); await sleep(300);
  check('the loaded save is still there after a reload', (await st(e.page)).dynasty?.user === dLocal.user);
} catch (e) {
  errors.push(String(e?.stack ?? e));
}
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'errors: none');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
