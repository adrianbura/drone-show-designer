/**
 * CANONICAL SHOW SITE / GPS GEOFENCE.
 *
 * The core engines stay in the show-local metric frame documented in
 * `show/coordinates.ts`. A site anchors that frame to the real world:
 *
 *   origin      : WGS84 coordinate of show-local (0, 0, 0) — the pad centre
 *   headingDeg  : compass bearing (0 = north, 90 = east) of the local +Z axis
 *   perimeter   : authorised flight polygon in WGS84 (>= 3 points)
 *   marginM     : horizontal clearance that must remain inside the perimeter
 *   ceilingM    : authorised altitude above the site, metres AGL
 *
 * Conversion is a local tangent-plane (equirectangular) approximation. Over a
 * few kilometres — the size of any drone show area — the error is well below
 * the safety margins operators author, and the approximation is documented
 * rather than hidden. Nothing here derives or guesses a site: a project without
 * one behaves exactly as before and reports NO geofence result at all.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface ShowSite {
  origin: GeoPoint;
  /** Compass bearing of the show-local +Z axis, degrees, 0 = north. */
  headingDeg: number;
  perimeter: GeoPoint[];
  /** Required horizontal clearance inside the perimeter, metres. */
  marginM: number;
  /** Authorised ceiling above the site, metres AGL. */
  ceilingM: number;
  /**
   * Where the audience stands. Optional: a site without it is still valid, and
   * no viewing direction is fabricated when it is absent. Its only role is to
   * tell the operator which way authored visuals must face.
   */
  audience?: GeoPoint | undefined;
}

export const EARTH_METRES_PER_LAT_DEG = 111_320;

export const DEFAULT_SITE_MARGIN_M = 5;
export const DEFAULT_SITE_CEILING_M = 120;

const DEG = Math.PI / 180;

function metresPerLonDeg(latDeg: number): number {
  return EARTH_METRES_PER_LAT_DEG * Math.cos(latDeg * DEG);
}

/** Horizontal show-local position, metres. Altitude is handled separately. */
export interface LocalXZ {
  x: number;
  z: number;
}

/** WGS84 -> show-local metres (x east/right, z along the site heading). */
export function geoToLocal(point: GeoPoint, site: ShowSite): LocalXZ {
  const east = (point.lon - site.origin.lon) * metresPerLonDeg(site.origin.lat);
  const north = (point.lat - site.origin.lat) * EARTH_METRES_PER_LAT_DEG;
  const b = site.headingDeg * DEG;
  return {
    x: east * Math.cos(b) - north * Math.sin(b),
    z: east * Math.sin(b) + north * Math.cos(b),
  };
}

/** Show-local metres -> WGS84. Exact inverse of `geoToLocal`. */
export function localToGeo(local: LocalXZ, site: ShowSite): GeoPoint {
  const b = site.headingDeg * DEG;
  const east = local.x * Math.cos(b) + local.z * Math.sin(b);
  const north = -local.x * Math.sin(b) + local.z * Math.cos(b);
  return {
    lat: site.origin.lat + north / EARTH_METRES_PER_LAT_DEG,
    lon: site.origin.lon + east / metresPerLonDeg(site.origin.lat),
  };
}

/** The authorised polygon expressed in show-local metres, in author order. */
export function perimeterLocal(site: ShowSite): LocalXZ[] {
  return site.perimeter.map((point) => geoToLocal(point, site));
}

function pointInPolygon(point: LocalXZ, polygon: readonly LocalXZ[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.z > point.z !== b.z > point.z;
    if (!straddles) continue;
    const t = (point.z - a.z) / (b.z - a.z);
    if (point.x < a.x + t * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: LocalXZ, a: LocalXZ, b: LocalXZ): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.z - a.z);
  let t = ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
}

/** Shortest horizontal distance from a local point to the perimeter, metres. */
export function distanceToPerimeter(point: LocalXZ, polygon: readonly LocalXZ[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, distanceToSegment(point, polygon[i]!, polygon[j]!));
  }
  return best;
}

export type GeofenceStatus = "inside" | "margin" | "outside" | "ceiling";

export interface GeofencePointResult {
  status: GeofenceStatus;
  /** Signed clearance: positive inside the polygon, negative outside. */
  clearanceM: number;
  /** Altitude headroom below the authorised ceiling, metres. */
  headroomM: number;
}

/** Site validity: a polygon needs at least three distinct points. */
export function isSiteUsable(site: ShowSite | undefined | null): site is ShowSite {
  return !!site && Array.isArray(site.perimeter) && site.perimeter.length >= 3;
}

/**
 * Classifies one show-local position against the site. `outside` and `ceiling`
 * are hard breaches; `margin` means still inside the polygon but closer to the
 * boundary than the authored clearance.
 */
export function classifyPosition(
  position: readonly [number, number, number],
  site: ShowSite,
  polygon: readonly LocalXZ[] = perimeterLocal(site),
): GeofencePointResult {
  const point: LocalXZ = { x: position[0], z: position[2] };
  const inside = pointInPolygon(point, polygon);
  const distance = distanceToPerimeter(point, polygon);
  const clearanceM = inside ? distance : -distance;
  const headroomM = site.ceilingM - position[1];
  if (!inside) return { status: "outside", clearanceM, headroomM };
  if (headroomM < 0) return { status: "ceiling", clearanceM, headroomM };
  if (clearanceM < site.marginM) return { status: "margin", clearanceM, headroomM };
  return { status: "inside", clearanceM, headroomM };
}

export interface GeofenceBreach {
  droneIndex: number;
  time: number;
  status: Exclude<GeofenceStatus, "inside">;
  clearanceM: number;
  headroomM: number;
}

export interface GeofenceScanSample {
  droneIndex: number;
  time: number;
  position: readonly [number, number, number];
}

export interface GeofenceScanResult {
  /** Worst breach per drone, hard breaches first. Deterministic order. */
  breaches: GeofenceBreach[];
  outsideCount: number;
  marginCount: number;
  ceilingCount: number;
  /** Smallest signed clearance seen anywhere in the scan, metres. */
  minClearanceM: number;
  /** Smallest altitude headroom seen anywhere in the scan, metres. */
  minHeadroomM: number;
  sampleCount: number;
}

const STATUS_RANK: Record<GeofenceStatus, number> = {
  outside: 3,
  ceiling: 2,
  margin: 1,
  inside: 0,
};

/**
 * Scans samples against the site and keeps the single worst breach per drone,
 * so a report stays readable for a 500-drone show. Pure and deterministic.
 */
export function scanGeofence(
  samples: Iterable<GeofenceScanSample>,
  site: ShowSite,
): GeofenceScanResult {
  const polygon = perimeterLocal(site);
  const worst = new Map<number, GeofenceBreach>();
  let outsideCount = 0;
  let marginCount = 0;
  let ceilingCount = 0;
  let minClearanceM = Infinity;
  let minHeadroomM = Infinity;
  let sampleCount = 0;

  for (const sample of samples) {
    sampleCount += 1;
    const result = classifyPosition(sample.position, site, polygon);
    minClearanceM = Math.min(minClearanceM, result.clearanceM);
    minHeadroomM = Math.min(minHeadroomM, result.headroomM);
    if (result.status === "inside") continue;
    if (result.status === "outside") outsideCount += 1;
    else if (result.status === "ceiling") ceilingCount += 1;
    else marginCount += 1;
    const candidate: GeofenceBreach = {
      droneIndex: sample.droneIndex,
      time: sample.time,
      status: result.status,
      clearanceM: result.clearanceM,
      headroomM: result.headroomM,
    };
    const previous = worst.get(sample.droneIndex);
    if (
      !previous ||
      STATUS_RANK[candidate.status] > STATUS_RANK[previous.status] ||
      (STATUS_RANK[candidate.status] === STATUS_RANK[previous.status] &&
        candidate.clearanceM < previous.clearanceM)
    ) {
      worst.set(sample.droneIndex, candidate);
    }
  }

  const breaches = [...worst.values()].sort(
    (a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.droneIndex - b.droneIndex,
  );
  return {
    breaches,
    outsideCount,
    marginCount,
    ceilingCount,
    minClearanceM: Number.isFinite(minClearanceM) ? minClearanceM : 0,
    minHeadroomM: Number.isFinite(minHeadroomM) ? minHeadroomM : 0,
    sampleCount,
  };
}

/** Axis-aligned local bounds of the perimeter, metres. */
export function perimeterBounds(site: ShowSite): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const polygon = perimeterLocal(site);
  return polygon.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minZ: Math.min(acc.minZ, p.z),
      maxZ: Math.max(acc.maxZ, p.z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeGeoPoint(value: unknown): GeoPoint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<GeoPoint>;
  if (typeof raw.lat !== "number" || !Number.isFinite(raw.lat)) return null;
  if (typeof raw.lon !== "number" || !Number.isFinite(raw.lon)) return null;
  if (Math.abs(raw.lat) > 90 || Math.abs(raw.lon) > 180) return null;
  return { lat: raw.lat, lon: raw.lon };
}

/**
 * Defensive read of a persisted site. Returns undefined when the payload
 * carries no usable origin, so a malformed file never fabricates a geofence.
 */
export function sanitizeShowSite(value: unknown): ShowSite | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<ShowSite>;
  const origin = sanitizeGeoPoint(raw.origin);
  if (!origin) return undefined;
  const perimeter = Array.isArray(raw.perimeter)
    ? raw.perimeter.map(sanitizeGeoPoint).filter((p): p is GeoPoint => p !== null)
    : [];
  return {
    origin,
    headingDeg: finite(raw.headingDeg, 0),
    perimeter,
    marginM: Math.max(0, finite(raw.marginM, DEFAULT_SITE_MARGIN_M)),
    ceilingM: Math.max(1, finite(raw.ceilingM, DEFAULT_SITE_CEILING_M)),
    ...(sanitizeGeoPoint(raw.audience) ? { audience: sanitizeGeoPoint(raw.audience)! } : {}),
  };
}

/** Rectangular perimeter around the origin, useful as a first authored site. */
export function rectangularPerimeter(
  site: Pick<ShowSite, "origin" | "headingDeg">,
  widthM: number,
  depthM: number,
): GeoPoint[] {
  const halfW = Math.max(1, widthM) / 2;
  const halfD = Math.max(1, depthM) / 2;
  const full: ShowSite = {
    origin: site.origin,
    headingDeg: site.headingDeg,
    perimeter: [],
    marginM: DEFAULT_SITE_MARGIN_M,
    ceilingM: DEFAULT_SITE_CEILING_M,
  };
  return [
    { x: -halfW, z: -halfD },
    { x: halfW, z: -halfD },
    { x: halfW, z: halfD },
    { x: -halfW, z: halfD },
  ].map((local) => localToGeo(local, full));
}

export interface AudienceOrientation {
  /** Audience position in the show-local frame, metres. */
  local: LocalXZ;
  /** Horizontal distance from the take-off origin to the audience, metres. */
  distanceM: number;
  /** Compass bearing from the show origin towards the audience, degrees. */
  bearingDeg: number;
  /**
   * Yaw, in show-local degrees around +Y, that turns a visual authored facing
   * local -Z into a visual facing the audience. This is the number an operator
   * copies into a visual rotation.
   */
  facingYawDeg: number;
}

/**
 * Where the audience is relative to the show, and which yaw makes a visual face
 * it. Returns null when the site carries no audience position: the viewing
 * direction is never invented.
 */
export function audienceOrientation(site: ShowSite): AudienceOrientation | null {
  if (!site.audience) return null;
  const local = geoToLocal(site.audience, site);
  const distanceM = Math.hypot(local.x, local.z);
  if (distanceM < 0.5) return null;
  const east = (site.audience.lon - site.origin.lon) * metresPerLonDeg(site.origin.lat);
  const north = (site.audience.lat - site.origin.lat) * EARTH_METRES_PER_LAT_DEG;
  const bearingDeg = (Math.atan2(east, north) / DEG + 360) % 360;
  // A visual authored facing local -Z must yaw by the local bearing of the
  // audience direction, measured from -Z towards +X.
  const facingYawDeg = (Math.atan2(local.x, -local.z) / DEG + 360) % 360;
  return { local, distanceM, bearingDeg, facingYawDeg };
}

/** Human-readable one-line summary for panels and reports. */
export function siteSummary(site: ShowSite): string {
  const lat = site.origin.lat.toFixed(5);
  const lon = site.origin.lon.toFixed(5);
  const points = site.perimeter.length;
  return `${lat}, ${lon} · ${points} perimeter point${points === 1 ? "" : "s"} · margin ${site.marginM} m · ceiling ${site.ceilingM} m${site.audience ? ` · audience ${site.audience.lat.toFixed(5)}, ${site.audience.lon.toFixed(5)}` : " · no audience set"}`;
}
