/** Tiny synthesized sound effects. No audio files; everything is generated with Web Audio. */
let ctx: AudioContext | null = null;
let muted = false;

export function unlockAudio(): void {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}
export function setMuted(m: boolean): void {
  muted = m;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slide = 0): void {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  select: () => tone(660, 0.06, 'square', 0.04),
  snap: () => tone(180, 0.07, 'square', 0.06),
  tackle: () => tone(90, 0.16, 'sawtooth', 0.09, 0, -50),
  whistle: () => { tone(2100, 0.22, 'square', 0.03); tone(2300, 0.22, 'square', 0.02, 0.02); },
  kick: () => tone(140, 0.12, 'triangle', 0.1, 0, -80),
  first: () => { tone(523, 0.08, 'square', 0.04); tone(784, 0.12, 'square', 0.04, 0.09); },
  score: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.05, i * 0.13)),
  bad: () => { tone(330, 0.18, 'sawtooth', 0.05); tone(220, 0.3, 'sawtooth', 0.05, 0.16); },
};
