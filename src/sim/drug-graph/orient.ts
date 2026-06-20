import type { Vec2, OrientFn, EffectiveDeltaFn } from "../phase0_interfaces";

// Canonicalize -0 to 0 so vector coords stay value-stable under Object.is /
// deep-equality (negating a 0 component yields -0 otherwise).
const z = (n: number): number => n + 0;

/** Negate a vector component-wise: (x,y) -> (-x,-y). */
export function negate(v: Vec2): Vec2 {
  return { x: z(-v.x), y: z(-v.y) };
}

/** Clockwise perpendicular in a y-down grid: perpCW(x,y) = (-y, x). */
export function perpCW(v: Vec2): Vec2 {
  return { x: z(-v.y), y: v.x };
}

/** +45° diagonal skew: skew(x,y) = (x - y, x + y). */
export function skew(v: Vec2): Vec2 {
  return { x: z(v.x - v.y), y: z(v.x + v.y) };
}

/** One 90° clockwise quarter-turn in a y-down grid: (x,y) -> (-y, x). */
function rotCW(v: Vec2): Vec2 {
  return { x: z(-v.y), y: v.x };
}

/**
 * Rotate a vector `o.rot` quarter-turns clockwise, THEN mirror x if `o.flip`.
 * INV-4 (4 rotations = identity), INV-5 (flip twice = identity).
 */
export const orient: OrientFn = (v, o) => {
  let r: Vec2 = v;
  for (let i = 0; i < o.rot; i++) r = rotCW(r);
  if (o.flip) r = { x: z(-r.x), y: r.y };
  return r;
};

/**
 * The effective translation delta combining the machine's relation and orientation.
 *  - forward:       orient(delta, o)
 *  - reverse:       orient(negate(delta), o)
 *  - perpendicular: orient(perpCW(delta), o)
 *  - offset:        orient(skew(delta), o)
 */
export const effectiveDelta: EffectiveDeltaFn = (delta, relation, o) => {
  const base: Vec2 =
    relation === "reverse"
      ? negate(delta)
      : relation === "perpendicular"
        ? perpCW(delta)
        : relation === "offset"
          ? skew(delta)
          : delta;
  return orient(base, o);
};
