// Two browsers with fake microphones join voice chat in an online lobby and must connect directly to each other.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const PORT = 8791;
const server = spawn('npx', ['tsx', 'tools/mock-online.ts', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-web-security', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) errors.push(`check failed: ${name}`); };
async function open(tag) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1000, height: 900 });
  await page.evaluateOnNewDocument((url) => { window.__fndOnlineUrl = url; }, `http://localhost:${PORT}`);
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/40[49]/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  await page.goto(`${pathToFileURL('site/play/index.html').href}?lowres`);
  await sleep(300);
  await page.click('#title');
  await sleep(100);
  return page;
}
const st = (p) => p.evaluate(() => window.__fnd.state());
const signIn = async (p, name, pin) => { await p.click('#goOnline').catch(() => {}); await p.type('#oName', name); await p.type('#oPin', pin); await p.click('#oEnter'); await p.waitForSelector('#oSignedIn:not(.hidden)'); };
const until = async (fn, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(300); } return false; };
try {
  const a = await open('host');
  const b = await open('guest');
  await signIn(a, 'ANN', '1111');
  await signIn(b, 'BO', '2222');
  await a.click('#oHost');
  await a.waitForSelector('#lobby:not(.hidden)');
  const pin = await a.$eval('#lobbyPin', (e) => e.textContent);
  await b.type('#oJoinPin', pin);
  await b.click('#oJoin');
  await b.waitForSelector('#lobby:not(.hidden)');
  await a.click('#lobbyVoice');
  check('host turns voice on', await until(async () => (await st(a)).online.voice === 'on', 8000));
  check('guest is told the host has voice on', await until(async () => (await b.$eval('#lobbyVoiceState', (e) => e.textContent)).includes('has voice on'), 8000));
  await b.click('#lobbyVoice');
  const linked = await until(async () => (await st(a)).online.peer === 'connected' && (await st(b)).online.peer === 'connected');
  check('the two browsers connect directly for audio', linked);
  if (linked) {
    const flowing = await until(async () => a.evaluate(async () => {
      const v = window.__fndVoice;
      const peer = [...v.peers.values()][0];
      const stats = await peer.pc.getStats();
      let bytes = 0;
      stats.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') bytes += r.bytesReceived ?? 0; });
      return bytes > 2000;
    }), 10000);
    check('audio is actually arriving at the host', flowing);
  }
  await a.screenshot({ path: `${out}/voice-lobby.png` });
  await a.click('#lobbyMic');
  check('mute button mutes the microphone', await a.evaluate(() => window.__fndVoice.micMuted && window.__fndVoice.stream.getAudioTracks().every((t) => !t.enabled)));
  await a.click('#lobbyStart');
  await a.waitForSelector('#game:not(.hidden)');
  await b.waitForSelector('#game:not(.hidden)');
  await sleep(2500);
  check('voice carries on from the lobby into the game', (await st(a)).online.peer === 'connected' && (await st(b)).online.peer === 'connected');
  await a.screenshot({ path: `${out}/voice-game.png` });
  await b.click('#voiceBtn');
  check('when one coach leaves voice, the other sees it', await until(async () => (await st(a)).online.peer === null, 15000));
  check('leaving releases the microphone', await b.evaluate(() => window.__fndVoice.stream === null));
} catch (e) {
  errors.push(String(e));
} finally {
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  server.kill();
  process.exit(errors.length ? 1 : 0);
}
