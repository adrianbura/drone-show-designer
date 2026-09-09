import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MapPin, Trash2 } from "lucide-react";

import {
  audienceOrientation,
  DEFAULT_SITE_CEILING_M,
  DEFAULT_SITE_MARGIN_M,
  isSiteUsable,
  localToGeo,
  rectangularPerimeter,
  siteSummary,
  type GeoPoint,
  type ShowSite,
} from "@/lib/show/geo";
import {
  checkProjectGeofence,
  geofenceVerdict,
  geofenceVerdictLabel,
} from "@/lib/studio/siteGeofence";
import { useStudio } from "@/lib/studio/store";

function Field({
  label,
  value,
  unit,
  step = 1,
  min,
  testId,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  min?: number;
  testId: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
        {unit ? ` (${unit})` : ""}
      </span>
      <input
        type="number"
        data-testid={testId}
        value={value}
        step={step}
        {...(min !== undefined ? { min } : {})}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="studio-input font-mono text-xs"
      />
    </label>
  );
}

/**
 * REAL SITE / GPS GEOFENCE AUTHORING (presentation only).
 *
 * Writes the canonical `project.site` through the existing `patchProject`
 * authority and mirrors the canonical geofence classification. It never
 * computes its own safety verdict and never blocks export by itself: the
 * verdict shown here is the canonical site classification of the authored
 * formation geometry, and full-show validation stays the export authority.
 */
export default function SitePanel() {
  const { project, patchProject } = useStudio();
  const site = project.site;
  const [result, setResult] = useState<ReturnType<typeof checkProjectGeofence> | null>(null);

  const verdict = geofenceVerdict(result);
  const checkedSummary = useMemo(() => (site ? siteSummary(site) : ""), [site]);
  const audience = useMemo(() => (site ? audienceOrientation(site) : null), [site]);

  const patchSite = (patch: Partial<ShowSite>) => {
    if (!site) return;
    setResult(null);
    patchProject({ site: { ...site, ...patch } });
  };

  const createSite = () => {
    const origin: GeoPoint = { lat: 44.4268, lon: 26.1025 };
    const created: ShowSite = {
      origin,
      headingDeg: 0,
      perimeter: rectangularPerimeter(
        { origin, headingDeg: 0 },
        project.area.width + 20,
        project.area.depth + 20,
      ),
      marginM: DEFAULT_SITE_MARGIN_M,
      ceilingM: Math.max(project.limits.maxAltitude, DEFAULT_SITE_CEILING_M),
    };
    setResult(null);
    patchProject({ site: created });
  };

  const removeSite = () => {
    setResult(null);
    patchProject({ site: undefined });
  };

  const fitPerimeterToArea = () => {
    if (!site) return;
    patchSite({
      perimeter: rectangularPerimeter(site, project.area.width + 20, project.area.depth + 20),
    });
  };

  const addPerimeterPoint = () => {
    if (!site) return;
    const last = site.perimeter[site.perimeter.length - 1];
    const next = last
      ? { lat: last.lat + 0.0002, lon: last.lon + 0.0002 }
      : localToGeo({ x: 0, z: 0 }, site);
    patchSite({ perimeter: [...site.perimeter, next] });
  };

  const patchPerimeterPoint = (index: number, patch: Partial<GeoPoint>) => {
    if (!site) return;
    patchSite({
      perimeter: site.perimeter.map((point, i) => (i === index ? { ...point, ...patch } : point)),
    });
  };

  const removePerimeterPoint = (index: number) => {
    if (!site) return;
    patchSite({ perimeter: site.perimeter.filter((_, i) => i !== index) });
  };

  if (!site) {
    return (
      <section className="panel-card" data-testid="site-panel">
        <h2 className="panel-title">
          <MapPin className="size-3.5" /> Flight site
        </h2>
        <p className="pb-2 text-[11px] leading-relaxed text-muted-foreground">
          No real-world site is set, so no GPS boundary can be checked. Add one to anchor the show
          to real coordinates and check the authorised area.
        </p>
        <button
          data-testid="site-create"
          onClick={createSite}
          className="chip-btn w-full justify-center"
        >
          Set flight site
        </button>
      </section>
    );
  }

  return (
    <section className="panel-card" data-testid="site-panel">
      <h2 className="panel-title">
        <MapPin className="size-3.5" /> Flight site
      </h2>
      <p
        className="pb-2 font-mono text-[10px] leading-relaxed text-muted-foreground"
        data-testid="site-summary"
      >
        {checkedSummary}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Take-off latitude"
          testId="site-origin-lat"
          value={site.origin.lat}
          step={0.0001}
          onChange={(lat) => patchSite({ origin: { ...site.origin, lat } })}
        />
        <Field
          label="Take-off longitude"
          testId="site-origin-lon"
          value={site.origin.lon}
          step={0.0001}
          onChange={(lon) => patchSite({ origin: { ...site.origin, lon } })}
        />
        <Field
          label="Stage heading"
          unit="° from north"
          testId="site-heading"
          value={site.headingDeg}
          step={1}
          onChange={(headingDeg) => patchSite({ headingDeg })}
        />
        <Field
          label="Clearance margin"
          unit="m"
          testId="site-margin"
          value={site.marginM}
          min={0}
          onChange={(marginM) => patchSite({ marginM: Math.max(0, marginM) })}
        />
        <Field
          label="Authorised ceiling"
          unit="m AGL"
          testId="site-ceiling"
          value={site.ceilingM}
          min={1}
          step={5}
          onChange={(ceilingM) => patchSite({ ceilingM: Math.max(1, ceilingM) })}
        />
      </div>

      <div className="space-y-2 pt-3" data-testid="site-audience">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Audience position
        </p>
        {site.audience ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="Audience latitude"
                testId="site-audience-lat"
                value={site.audience.lat}
                step={0.0001}
                onChange={(lat) => patchSite({ audience: { ...site.audience!, lat } })}
              />
              <Field
                label="Audience longitude"
                testId="site-audience-lon"
                value={site.audience.lon}
                step={0.0001}
                onChange={(lon) => patchSite({ audience: { ...site.audience!, lon } })}
              />
            </div>
            {audience ? (
              <p
                className="font-mono text-[10px] leading-relaxed text-muted-foreground"
                data-testid="site-audience-orientation"
              >
                {audience.distanceM.toFixed(0)} m from take-off · bearing{" "}
                {audience.bearingDeg.toFixed(0)}° from north · visuals face the audience at yaw{" "}
                {audience.facingYawDeg.toFixed(0)}°
              </p>
            ) : (
              <p
                className="text-[11px] leading-relaxed text-warning"
                data-testid="site-audience-too-close"
              >
                The audience is on top of the take-off point, so no viewing direction can be
                derived. Move it to where people actually stand.
              </p>
            )}
            <button
              data-testid="site-audience-remove"
              onClick={() => patchSite({ audience: undefined })}
              className="chip-btn"
            >
              Remove audience position
            </button>
          </>
        ) : (
          <>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              No audience position set, so the viewing direction of your visuals is unknown.
            </p>
            <button
              data-testid="site-audience-add"
              onClick={() =>
                patchSite({
                  audience: localToGeo({ x: 0, z: -(project.area.depth / 2 + 40) }, site),
                })
              }
              className="chip-btn"
            >
              Set audience position
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button data-testid="site-fit-area" onClick={fitPerimeterToArea} className="chip-btn">
          Fit boundary to show area
        </button>
        <button data-testid="site-add-point" onClick={addPerimeterPoint} className="chip-btn">
          Add boundary point
        </button>
        <button data-testid="site-remove" onClick={removeSite} className="chip-btn">
          Remove site
        </button>
      </div>

      <div className="space-y-1 pt-2" data-testid="site-perimeter-list">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Authorised boundary ({site.perimeter.length} points)
        </p>
        {site.perimeter.length < 3 && (
          <p
            className="text-[11px] leading-relaxed text-warning"
            data-testid="site-perimeter-short"
          >
            A boundary needs at least 3 points before it can be checked.
          </p>
        )}
        {site.perimeter.map((point, index) => (
          <div key={index} className="flex items-center gap-1" data-testid={`site-point-${index}`}>
            <input
              type="number"
              aria-label={`Boundary point ${index + 1} latitude`}
              value={point.lat}
              step={0.0001}
              onChange={(e) => {
                const lat = Number(e.target.value);
                if (Number.isFinite(lat)) patchPerimeterPoint(index, { lat });
              }}
              className="studio-input font-mono text-[11px]"
            />
            <input
              type="number"
              aria-label={`Boundary point ${index + 1} longitude`}
              value={point.lon}
              step={0.0001}
              onChange={(e) => {
                const lon = Number(e.target.value);
                if (Number.isFinite(lon)) patchPerimeterPoint(index, { lon });
              }}
              className="studio-input font-mono text-[11px]"
            />
            <button
              aria-label={`Remove boundary point ${index + 1}`}
              onClick={() => removePerimeterPoint(index)}
              className="chip-btn"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-1 pt-3">
        <button
          data-testid="site-check"
          disabled={!isSiteUsable(site)}
          onClick={() => setResult(checkProjectGeofence(project, site))}
          className="chip-btn w-full justify-center disabled:opacity-40"
        >
          Check authorised area
        </button>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Checks the formations your timeline uses against the boundary. Flown transition paths are
          checked by Full-Show Validation, not here.
        </p>
        {result && (
          <div data-testid="site-check-result" className="space-y-1 pt-1">
            <p
              className={`metric-pill w-fit ${verdict === "blocked" ? "status-critical" : verdict === "warning" ? "status-warning" : "status-safe"}`}
              data-testid="site-check-verdict"
            >
              {verdict === "blocked" ? (
                <AlertTriangle className="size-3" />
              ) : (
                <CheckCircle2 className="size-3" />
              )}
              {geofenceVerdictLabel(verdict)}
            </p>
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              {result.checkedFormations} formation
              {result.checkedFormations === 1 ? "" : "s"} checked · closest to boundary{" "}
              {result.minClearanceM.toFixed(1)} m · ceiling headroom{" "}
              {result.minHeadroomM.toFixed(1)} m
            </p>
            {result.formations
              .filter((entry) => entry.scan.breaches.length > 0)
              .map((entry) => (
                <p
                  key={entry.formationId}
                  data-testid={`site-check-formation-${entry.formationId}`}
                  className="text-[11px] leading-relaxed text-muted-foreground"
                >
                  <span className="text-foreground">{entry.formationName}</span>:{" "}
                  {entry.scan.outsideCount} outside · {entry.scan.ceilingCount} above ceiling ·{" "}
                  {entry.scan.marginCount} inside margin
                </p>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}
