import { describe, expect, it } from "vitest";
import {
  audienceOrientation,
  classifyPosition,
  geoToLocal,
  isSiteUsable,
  localToGeo,
  rectangularPerimeter,
  sanitizeShowSite,
  scanGeofence,
  siteSummary,
  type ShowSite,
} from "../geo";
import { migrateProject } from "../defaultProject";

const ORIGIN = { lat: 44.4268, lon: 26.1025 };

function site(overrides: Partial<ShowSite> = {}): ShowSite {
  const base: ShowSite = {
    origin: ORIGIN,
    headingDeg: 0,
    perimeter: rectangularPerimeter({ origin: ORIGIN, headingDeg: 0 }, 100, 100),
    marginM: 5,
    ceilingM: 120,
  };
  return { ...base, ...overrides };
}

describe("site coordinate conversion", () => {
  it("round-trips local metres through WGS84", () => {
    const s = site();
    for (const local of [
      { x: 0, z: 0 },
      { x: 37.5, z: -12.25 },
      { x: -200, z: 480 },
    ]) {
      const back = geoToLocal(localToGeo(local, s), s);
      expect(back.x).toBeCloseTo(local.x, 6);
      expect(back.z).toBeCloseTo(local.z, 6);
    }
  });

  it("maps local +Z to the authored compass heading", () => {
    const north = localToGeo({ x: 0, z: 100 }, site({ headingDeg: 0 }));
    expect(north.lat).toBeGreaterThan(ORIGIN.lat);
    expect(north.lon).toBeCloseTo(ORIGIN.lon, 9);

    const east = localToGeo({ x: 0, z: 100 }, site({ headingDeg: 90 }));
    expect(east.lon).toBeGreaterThan(ORIGIN.lon);
    expect(east.lat).toBeCloseTo(ORIGIN.lat, 9);
  });

  it("keeps a rotated rectangle usable and centred on the origin", () => {
    const rotated = site({
      headingDeg: 33,
      perimeter: rectangularPerimeter({ origin: ORIGIN, headingDeg: 33 }, 80, 60),
    });
    expect(isSiteUsable(rotated)).toBe(true);
    expect(classifyPosition([0, 30, 0], rotated).status).toBe("inside");
    expect(classifyPosition([0, 30, 45], rotated).status).toBe("outside");
  });
});

describe("geofence classification", () => {
  it("reports inside, margin, outside and ceiling states", () => {
    const s = site();
    expect(classifyPosition([0, 40, 0], s).status).toBe("inside");
    expect(classifyPosition([48, 40, 0], s).status).toBe("margin");
    expect(classifyPosition([60, 40, 0], s).status).toBe("outside");
    expect(classifyPosition([0, 130, 0], s).status).toBe("ceiling");
  });

  it("signs clearance positive inside and negative outside", () => {
    const s = site();
    expect(classifyPosition([0, 40, 0], s).clearanceM).toBeCloseTo(50, 3);
    expect(classifyPosition([70, 40, 0], s).clearanceM).toBeCloseTo(-20, 3);
  });
});

describe("geofence scan", () => {
  const s = site();
  const samples = [
    { droneIndex: 0, time: 0, position: [0, 20, 0] as const },
    { droneIndex: 1, time: 1, position: [48, 20, 0] as const },
    { droneIndex: 1, time: 2, position: [80, 20, 0] as const },
    { droneIndex: 2, time: 3, position: [0, 200, 0] as const },
  ];

  it("keeps only the worst breach per drone", () => {
    const result = scanGeofence(samples, s);
    expect(result.breaches).toHaveLength(2);
    expect(result.breaches[0]).toMatchObject({ droneIndex: 1, status: "outside", time: 2 });
    expect(result.breaches[1]).toMatchObject({ droneIndex: 2, status: "ceiling" });
    expect(result.outsideCount).toBe(1);
    expect(result.marginCount).toBe(1);
    expect(result.ceilingCount).toBe(1);
    expect(result.sampleCount).toBe(4);
  });

  it("is deterministic and reports worst-case metrics", () => {
    const a = scanGeofence(samples, s);
    const b = scanGeofence(samples, s);
    expect(a).toEqual(b);
    expect(a.minClearanceM).toBeCloseTo(-30, 3);
    expect(a.minHeadroomM).toBeCloseTo(-80, 3);
  });

  it("returns no breaches for a compliant show", () => {
    const result = scanGeofence([{ droneIndex: 0, time: 0, position: [10, 50, -10] as const }], s);
    expect(result.breaches).toEqual([]);
    expect(result.minClearanceM).toBeGreaterThan(0);
  });
});

describe("site persistence", () => {
  it("rejects payloads without a usable origin", () => {
    expect(sanitizeShowSite(undefined)).toBeUndefined();
    expect(sanitizeShowSite({ perimeter: [] })).toBeUndefined();
    expect(sanitizeShowSite({ origin: { lat: 999, lon: 0 } })).toBeUndefined();
  });

  it("keeps a valid site and drops malformed perimeter points", () => {
    const parsed = sanitizeShowSite({
      origin: ORIGIN,
      headingDeg: 12,
      marginM: 8,
      ceilingM: 90,
      perimeter: [ORIGIN, { lat: "x", lon: 1 }, { lat: 44.5, lon: 26.2 }],
    });
    expect(parsed?.perimeter).toHaveLength(2);
    expect(parsed?.marginM).toBe(8);
    expect(parsed?.ceilingM).toBe(90);
  });

  it("survives project migration and stays absent when never authored", () => {
    const s = site();
    const withSite = migrateProject({ droneCount: 10, site: s });
    expect(withSite.site?.perimeter).toHaveLength(4);
    expect(migrateProject({ droneCount: 10 }).site).toBeUndefined();
    expect(migrateProject({ droneCount: 10, site: { origin: null } }).site).toBeUndefined();
  });

  it("summarises a site for the operator", () => {
    expect(siteSummary(site())).toContain("4 perimeter points");
  });
});

describe("audience orientation", () => {
  const origin = { lat: 44.4, lon: 26.1 };

  it("reports no viewing direction when no audience is set", () => {
    const site = {
      origin,
      headingDeg: 0,
      perimeter: rectangularPerimeter({ origin, headingDeg: 0 }, 200, 200),
      marginM: 5,
      ceilingM: 120,
    };
    expect(audienceOrientation(site)).toBeNull();
  });

  it("derives distance, bearing and facing yaw from the audience point", () => {
    const site = {
      origin,
      headingDeg: 0,
      perimeter: rectangularPerimeter({ origin, headingDeg: 0 }, 200, 200),
      marginM: 5,
      ceilingM: 120,
      audience: localToGeo(
        { x: 0, z: -100 },
        {
          origin,
          headingDeg: 0,
          perimeter: [],
          marginM: 5,
          ceilingM: 120,
        },
      ),
    };
    const orientation = audienceOrientation(site)!;
    expect(orientation.distanceM).toBeCloseTo(100, 0);
    expect(orientation.bearingDeg).toBeCloseTo(180, 0);
    expect(orientation.facingYawDeg).toBeCloseTo(0, 0);
  });

  it("keeps a sanitized audience point across migration", () => {
    const site = sanitizeShowSite({
      origin,
      headingDeg: 0,
      perimeter: rectangularPerimeter({ origin, headingDeg: 0 }, 200, 200),
      marginM: 5,
      ceilingM: 120,
      audience: { lat: 44.399, lon: 26.1 },
    })!;
    expect(site.audience).toEqual({ lat: 44.399, lon: 26.1 });
    expect(sanitizeShowSite({ ...site, audience: { lat: "x" } })!.audience).toBeUndefined();
  });
});
