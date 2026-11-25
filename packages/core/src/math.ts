/** Field geometry in integer units. 256 units = 1 yard. */
export const U = 256;
/** Field width, 53 1/3 yards. */
export const FIELD_W = 13653;
export const TICKS_PER_SECOND = 60;

export const yd = (n: number): number => Math.round(n * U);

/** Integer square root. Math.sqrt is correctly rounded by specification, so this is portable. */
export const isqrt = (n: number): number => Math.floor(Math.sqrt(n));

export const dist = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return isqrt(dx * dx + dy * dy);
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
