/** Seeded random numbers. The only source of randomness allowed in simulation packages. */

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 1;

  constructor(seed: number) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    for (let i = 0; i < 12; i++) this.u32();
  }

  /** A named stream derived from a seed. Adding draws to one stream never disturbs another. */
  static stream(seed: number, label: string): Rng {
    return new Rng((seed ^ hashString(label)) >>> 0);
  }

  /** sfc32 */
  u32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** [0, 1) */
  float(): number {
    return this.u32() / 4294967296;
  }

  /** Integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.float() * (hi - lo + 1));
  }

  range(lo: number, hi: number): number {
    return lo + this.float() * (hi - lo);
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}
