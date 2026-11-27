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

// ---------------------------------------------------------------- atmosphere
// Chants, the band and the PA. All made on the spot with Web Audio; there are no sound files.

interface NoteLike { f: number; t: number; d: number }

let noise: AudioBuffer | null = null;
let paOn = true;

function noiseBuffer(): AudioBuffer | null {
  if (!ctx) return null;
  if (noise) return noise;
  const len = ctx.sampleRate * 2;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  // Brown-ish noise: a crowd is mostly low rumble.
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.045 * white) / 1.045;
    data[i] = last * 4.2 + white * 0.12;
  }
  return noise;
}

/** A burst of crowd: `bright` for a cheer, dark and falling for a groan. */
function swell(gain: number, dur: number, from: number, to: number, delay = 0): void {
  if (!ctx || muted) return;
  const buf = noiseBuffer();
  if (!buf) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.7;
  f.frequency.setValueAtTime(from, t);
  f.frequency.linearRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + Math.min(0.25, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

function burst(freq: number, dur: number, gain: number, delay: number, q = 1.2): void {
  if (!ctx || muted) return;
  const buf = noiseBuffer();
  if (!buf) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}
/** A few hundred hands, never quite together. */
const clap = (delay: number, gain = 0.5): void => { for (let i = 0; i < 4; i++) burst(1300 + i * 260, 0.07, gain * 0.3, delay + i * 0.012); };
const stomp = (delay: number, gain = 0.14): void => { tone(72, 0.16, 'sine', gain, delay, -24); burst(160, 0.09, gain * 1.2, delay, 0.8); };
const snare = (delay: number, gain = 0.22): void => { burst(2400, 0.09, gain, delay, 0.6); tone(190, 0.05, 'triangle', gain * 0.2, delay); };

/** The stands shouting one syllable: a bank of voices on no particular note through a vowel. */
function shout(delay: number, dur: number, vowel: readonly [number, number], gain = 0.05): void {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(gain, t + 0.05);
  out.gain.setValueAtTime(gain, t + dur * 0.6);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out.connect(ctx.destination);
  for (const formant of vowel) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = formant;
    f.Q.value = 5;
    f.connect(out);
    for (let v = 0; v < 5; v++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(105 + v * 27 + Math.random() * 14, t);
      o.frequency.linearRampToValueAtTime(98 + v * 25, t + dur);
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.03);
    }
  }
  swell(gain * 1.5, dur, 900, 700, delay);
}

const EE = [320, 2400] as const;
const EH = [560, 1850] as const;

export const crowd = {
  /** A drum roll as the kicker runs up, for `secs` seconds. */
  rise: (secs: number): void => {
    for (let i = 0; i < 6; i++) snare(i * (secs / 7), 0.1 + i * 0.02);
  },
  /** "DE-FENSE" (stomp, stomp), three times. */
  defense: (): void => {
    for (let r = 0; r < 3; r++) {
      const t = r * 1.7;
      shout(t, 0.34, EE);
      shout(t + 0.42, 0.5, EH);
      stomp(t + 1.05);
      stomp(t + 1.3);
    }
  },
  /** Clap, clap, clap-clap-clap, twice. */
  letsGo: (): void => {
    for (let r = 0; r < 2; r++) [0, 0.42, 0.84, 1.05, 1.26].forEach((d) => clap(r * 2.1 + d));
  },
};

function brass(freq: number, dur: number, delay: number, gain: number): void {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(700, t);
  f.frequency.linearRampToValueAtTime(2300, t + 0.04);
  f.frequency.linearRampToValueAtTime(1500, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.025);
  g.gain.setValueAtTime(gain * 0.8, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g).connect(ctx.destination);
  // A section, not a soloist: three players a hair apart, and the tubas an octave down.
  for (const [mult, type, detune] of [[1, 'sawtooth', -7], [1, 'sawtooth', 6], [1, 'square', 0], [0.5, 'square', 3]] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq * mult;
    o.detune.value = detune;
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
}

export const band = {
  /** Plays a tune with the drum line under it. Returns how long it lasts, in seconds. */
  play: (song: readonly NoteLike[], beat: number, times = 1, gain = 0.035): number => {
    const length = song.length ? song[song.length - 1].t + song[song.length - 1].d : 0;
    const bar = Math.ceil(length / beat) * beat;
    for (let r = 0; r < times; r++) {
      const at = r * bar;
      for (const n of song) brass(n.f, n.d, at + n.t, gain);
      for (let b = 0; b * beat < bar - 0.01; b++) {
        if (b % 2 === 0) stomp(at + b * beat, 0.1);
        else snare(at + b * beat, 0.12);
        if (b % 4 === 3) snare(at + (b + 0.5) * beat, 0.08);
      }
    }
    return bar * times;
  },
  /** The drum line on its own: four bars of cadence. */
  cadence: (beat: number): number => {
    for (let b = 0; b < 16; b++) {
      if (b % 4 === 0) stomp(b * beat * 0.5, 0.12);
      snare(b * beat * 0.5, b % 2 ? 0.07 : 0.13);
      if (b % 8 === 6) { snare((b + 0.33) * beat * 0.5, 0.07); snare((b + 0.66) * beat * 0.5, 0.07); }
    }
    return 8 * beat;
  },
  /** Three notes up from the horns for a first down. */
  stab: (song: readonly NoteLike[]): void => {
    const f = song.length ? song[0].f : 233;
    brass(f, 0.12, 0, 0.03);
    brass(f * 1.26, 0.12, 0.14, 0.03);
    brass(f * 1.5, 0.3, 0.28, 0.035);
    snare(0.28, 0.12);
  },
};

export function setPa(on: boolean): void {
  paOn = on;
  if (!on) try { window.speechSynthesis?.cancel(); } catch { /* no speech here */ }
}

/** Voices that sound like a person, best first. What is installed differs on every phone and computer. */
const GOOD_VOICES = [/natural/i, /neural/i, /premium/i, /enhanced/i, /^Google US English$/, /^Samantha$/, /^Alex$/, /^Daniel$/, /^Google UK English Male$/, /Aria|Guy|Jenny|Davis/];
let voice: SpeechSynthesisVoice | null | undefined;
function pickVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
  if (!all.length) return null;
  for (const want of GOOD_VOICES) {
    const hit = all.find((v) => want.test(v.name) && /US/i.test(v.lang)) ?? all.find((v) => want.test(v.name));
    if (hit) return hit;
  }
  return all.find((v) => /US/i.test(v.lang)) ?? all[0];
}

/**
 * The public address announcer. It speaks with the most natural English voice the browser has, at an
 * ordinary pitch and pace. Silent where the browser has no speech.
 */
export function announce(text: string): void {
  if (muted || !paOn) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    // The list of voices arrives late in some browsers: look again until one turns up.
    if (!voice) voice = pickVoice();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = 1;
    u.pitch = 1;
    u.volume = 0.9;
    synth.speak(u);
  } catch { /* no speech here */ }
}

/** Mute also stops the announcer in mid-sentence. */
export function refreshAtmosphere(): void {
  if (muted) try { window.speechSynthesis?.cancel(); } catch { /* no speech here */ }
}
