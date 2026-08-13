/**
 * CANONICAL INTERNAL COORDINATE SYSTEM — "show-local"
 *
 * This is the single convention used by every engine, the viewport and every
 * export. It matches what the existing implementation already used; nothing was
 * reoriented.
 *
 *   origin      : centre of the show-area floor (take-off pad centre)
 *   units       : metres for distance, seconds for time, degrees for angles
 *   +X          : east / stage right
 *   +Y          : up  (ALTITUDE AXIS — "altitude" always means Y)
 *   +Z          : north / depth (towards the audience-far side)
 *   handedness  : right-handed (matches Three.js)
 *   ground      : y = 0. A landed drone is at y = 0.
 *   yaw zero    : +X axis (heading 0° looks along +X)
 *   yaw positive: counter-clockwise seen from above (+Y), i.e. from +X toward +Z
 *   yaw range   : normalised to (-180, 180]
 *
 * Derived quantities:
 *   velocity      m/s
 *   acceleration  m/s^2
 *   jerk          m/s^3
 *   yawRate       deg/s
 *
 * NOTE: no other convention is permitted inside the core. Adapters may convert
 * (e.g. to NED / ENU) at their own boundary and must document the conversion.
 */

export const COORDINATE_SYSTEM = {
  id: "show-local",
  units: { distance: "m", time: "s", angle: "deg" },
  axes: { x: "east/right", y: "up/altitude", z: "north/depth" },
  origin: "centre of show-area floor",
  handedness: "right-handed",
  groundAltitude: 0,
  yawZeroAxis: "+X",
  yawPositiveDirection: "counter-clockwise viewed from +Y",
  yawRange: "(-180, 180]",
} as const;

/** Normalises any angle in degrees to (-180, 180]. */
export function normalizeYawDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return a;
}

/** Shortest signed difference b - a in degrees, in (-180, 180]. */
export function yawDeltaDeg(a: number, b: number): number {
  return normalizeYawDeg(b - a);
}

/** Heading in degrees for a horizontal velocity, yaw zero along +X. */
export function headingFromVelocity(vx: number, vz: number): number {
  return normalizeYawDeg((Math.atan2(vz, vx) * 180) / Math.PI);
}
