/**
 * SVG parser — untrusted markup to normalized geometry.
 *
 * SECURITY: the markup is NEVER inserted into the application DOM and no DOM
 * parser is used. This is a pure string scanner: scripts, event handlers,
 * <foreignObject>, external references and remote resources can therefore never
 * execute or be fetched. Everything is treated as inert geometry data.
 *
 * Supported: path, circle, ellipse, rect (incl. rx/ry), line, polyline,
 * polygon, nested <g>, transform (translate/scale/rotate/matrix/skewX/skewY),
 * viewBox, and the presentation attributes fill, stroke, fill-opacity,
 * stroke-opacity, opacity, fill-rule (also via a simple inline `style`).
 * Anything else is reported as a warning — never silently ignored.
 */
import { boundsOf, flattenSubPath, IDENTITY, matrixScale, multiply, polylineLength } from "./flatten";
import { arcToCubics, parsePathData, type SubPath } from "./paths";
import {
  DEFAULT_MAX_SVG_BYTES,
  SvgError,
  type Bounds2,
  type Contour,
  type FillRule,
  type Matrix2D,
  type Point2,
  type SvgGeometry,
  type SvgWarning,
  type SvgWarningCode,
} from "./types";

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const SELF_CLOSING_ONLY = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "use",
  "image",
  "stop",
]);

const GEOMETRY_TAGS = new Set(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);
const CONTAINER_TAGS = new Set(["svg", "g", "a", "switch"]);
/** Definition containers: parsed for structure but not rendered as geometry. */
const IGNORED_TAGS = new Set([
  "defs",
  "title",
  "desc",
  "metadata",
  "style",
  "linearGradient",
  "radialGradient",
  "pattern",
  "symbol",
  "marker",
  "stop",
  "clipPath",
  "mask",
  "filter",
]);

function decodeEntities(v: string): string {
  return v
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:A-Za-z_][-:.\w]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1]!.toLowerCase();
    attrs[name] = decodeEntities(m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Minimal, allocation-light XML scanner. Returns the root <svg> node. */
export function scanSvg(source: string): XmlNode {
  const cleaned = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "");

  const root: XmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const re = /<\s*(\/?)\s*([A-Za-z_][-:.\w]*)((?:\s+[^<>]*?)?)(\/?)\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const closing = m[1] === "/";
    const tagRaw = m[2]!;
    const tag = tagRaw.includes(":") ? tagRaw.slice(tagRaw.indexOf(":") + 1) : tagRaw;
    const selfClose = m[4] === "/";
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const node: XmlNode = { tag, attrs: parseAttrs(m[3] ?? ""), children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClose && !SELF_CLOSING_ONLY.has(tag)) stack.push(node);
  }

  const svg = root.children.find((c) => c.tag === "svg");
  if (!svg) throw new SvgError("INVALID_SVG", "No <svg> root element was found in the file.");
  return svg;
}

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const parsed = Number.parseFloat(v);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberList(v: string | undefined): number[] {
  if (!v) return [];
  return v
    .split(/[\s,]+/)
    .map((s) => Number.parseFloat(s))
    .filter((n) => Number.isFinite(n));
}

export function parseTransform(value: string | undefined): { matrix: Matrix2D; unsupported: string[] } {
  const unsupported: string[] = [];
  if (!value) return { matrix: IDENTITY, unsupported };
  let m: Matrix2D = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const fn = match[1]!.toLowerCase();
    const a = parseNumberList(match[2]);
    switch (fn) {
      case "translate":
        m = multiply(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]);
        break;
      case "scale": {
        const sx = a[0] ?? 1;
        m = multiply(m, [sx, 0, 0, a[1] ?? sx, 0, 0]);
        break;
      }
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        const rot: Matrix2D = [cos, sin, -sin, cos, 0, 0];
        if (a.length >= 3) {
          m = multiply(m, [1, 0, 0, 1, a[1]!, a[2]!]);
          m = multiply(m, rot);
          m = multiply(m, [1, 0, 0, 1, -a[1]!, -a[2]!]);
        } else {
          m = multiply(m, rot);
        }
        break;
      }
      case "matrix":
        if (a.length >= 6) m = multiply(m, [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!]);
        else unsupported.push(match[0]!);
        break;
      case "skewx":
        m = multiply(m, [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]);
        break;
      case "skewy":
        m = multiply(m, [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]);
        break;
      default:
        unsupported.push(match[0]!);
    }
  }
  return { matrix: m, unsupported };
}

interface StyleState {
  fill: string;
  stroke: string;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  fillRule: FillRule;
  display: string;
}

const ROOT_STYLE: StyleState = {
  fill: "black",
  stroke: "none",
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
  fillRule: "nonzero",
  display: "inline",
};

function styleMap(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const style = attrs["style"];
  if (style) {
    for (const decl of style.split(";")) {
      const idx = decl.indexOf(":");
      if (idx > 0) out[decl.slice(0, idx).trim().toLowerCase()] = decl.slice(idx + 1).trim();
    }
  }
  return out;
}

function inheritStyle(parent: StyleState, attrs: Record<string, string>): StyleState {
  const css = styleMap(attrs);
  const read = (key: string) => css[key] ?? attrs[key];
  const fillRuleRaw = (read("fill-rule") ?? parent.fillRule).toLowerCase();
  return {
    fill: read("fill") ?? parent.fill,
    stroke: read("stroke") ?? parent.stroke,
    fillOpacity: num(read("fill-opacity"), parent.fillOpacity),
    strokeOpacity: num(read("stroke-opacity"), parent.strokeOpacity),
    opacity: num(read("opacity"), 1) * parent.opacity,
    fillRule: fillRuleRaw === "evenodd" ? "evenodd" : "nonzero",
    display: read("display") ?? parent.display,
  };
}

const isNone = (paint: string) => {
  const p = paint.trim().toLowerCase();
  return p === "none" || p === "transparent";
};

/** Rect/ellipse/circle/line/poly* to subpaths in local user units. */
function shapeToSubPaths(node: XmlNode, warn: (c: SvgWarningCode, m: string) => void): SubPath[] {
  const a = node.attrs;
  switch (node.tag) {
    case "path": {
      const d = a["d"];
      if (!d) return [];
      return parsePathData(d);
    }
    case "rect": {
      const x = num(a["x"]);
      const y = num(a["y"]);
      const w = num(a["width"]);
      const h = num(a["height"]);
      if (w <= 0 || h <= 0) return [];
      let rx = a["rx"] !== undefined ? num(a["rx"]) : a["ry"] !== undefined ? num(a["ry"]) : 0;
      let ry = a["ry"] !== undefined ? num(a["ry"]) : rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (rx === 0 || ry === 0) {
        return [
          {
            start: [x, y],
            segments: [
              { t: "L", x: x + w, y },
              { t: "L", x: x + w, y: y + h },
              { t: "L", x, y: y + h },
            ],
            closed: true,
          },
        ];
      }
      const segs: SubPath["segments"] = [];
      const corner = (x0: number, y0: number, x1: number, y1: number) => {
        for (const c of arcToCubics(x0, y0, rx, ry, 0, false, true, x1, y1)) segs.push(c);
      };
      segs.push({ t: "L", x: x + w - rx, y });
      corner(x + w - rx, y, x + w, y + ry);
      segs.push({ t: "L", x: x + w, y: y + h - ry });
      corner(x + w, y + h - ry, x + w - rx, y + h);
      segs.push({ t: "L", x: x + rx, y: y + h });
      corner(x + rx, y + h, x, y + h - ry);
      segs.push({ t: "L", x, y: y + ry });
      corner(x, y + ry, x + rx, y);
      return [{ start: [x + rx, y], segments: segs, closed: true }];
    }
    case "circle":
    case "ellipse": {
      const cx = num(a["cx"]);
      const cy = num(a["cy"]);
      const r = num(a["r"]);
      const rx = node.tag === "circle" ? r : num(a["rx"]);
      const ry = node.tag === "circle" ? r : num(a["ry"]);
      if (rx <= 0 || ry <= 0) return [];
      const segs: SubPath["segments"] = [];
      for (const c of arcToCubics(cx + rx, cy, rx, ry, 0, false, true, cx - rx, cy)) segs.push(c);
      for (const c of arcToCubics(cx - rx, cy, rx, ry, 0, false, true, cx + rx, cy)) segs.push(c);
      return [{ start: [cx + rx, cy], segments: segs, closed: true }];
    }
    case "line": {
      return [
        {
          start: [num(a["x1"]), num(a["y1"])],
          segments: [{ t: "L", x: num(a["x2"]), y: num(a["y2"]) }],
          closed: false,
        },
      ];
    }
    case "polyline":
    case "polygon": {
      const nums = parseNumberList(a["points"]);
      if (nums.length < 4) return [];
      const segs: SubPath["segments"] = [];
      for (let i = 2; i + 1 < nums.length; i += 2) segs.push({ t: "L", x: nums[i]!, y: nums[i + 1]! });
      return [
        {
          start: [nums[0]!, nums[1]!],
          segments: segs,
          closed: node.tag === "polygon",
        },
      ];
    }
    default:
      warn("UNSUPPORTED_GEOMETRY", `Unsupported geometry element <${node.tag}> was skipped.`);
      return [];
  }
}

export interface ParseSvgOptions {
  fileName?: string;
  byteLength?: number;
  maxBytes?: number;
  /** Curve flattening tolerance, SVG user units. */
  flattenTolerance?: number;
}

/**
 * Parses SVG markup into the canonical {@link SvgGeometry}. Coordinates stay in
 * SVG user units with y pointing DOWN; `normalize.ts` maps them into the show
 * frame. Throws {@link SvgError} for structural failures.
 */
export function parseSvg(source: string, options: ParseSvgOptions = {}): SvgGeometry {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SVG_BYTES;
  const byteLength = options.byteLength ?? source.length;
  if (byteLength > maxBytes) {
    throw new SvgError(
      "FILE_TOO_LARGE",
      `SVG is ${(byteLength / 1024 / 1024).toFixed(1)} MB, above the ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`,
    );
  }
  if (!/<\s*svg[\s>]/i.test(source)) {
    throw new SvgError("INVALID_SVG", "The file does not look like an SVG document.");
  }

  const warnings: SvgWarning[] = [];
  const seenWarnings = new Set<string>();
  const warn = (code: SvgWarningCode, message: string, details?: string) => {
    if (seenWarnings.has(code)) return;
    seenWarnings.add(code);
    warnings.push(details === undefined ? { code, message } : { code, message, details });
  };

  const svg = scanSvg(source);
  const elementCounts: Record<string, number> = {};
  const contours: Contour[] = [];
  const tolerance = Math.max(0.01, options.flattenTolerance ?? 0.4);
  let contourSeq = 0;

  const viewBoxNums = parseNumberList(svg.attrs["viewbox"]);
  const viewBox: Bounds2 | null =
    viewBoxNums.length >= 4
      ? {
          minX: viewBoxNums[0]!,
          minY: viewBoxNums[1]!,
          maxX: viewBoxNums[0]! + viewBoxNums[2]!,
          maxY: viewBoxNums[1]! + viewBoxNums[3]!,
          width: viewBoxNums[2]!,
          height: viewBoxNums[3]!,
        }
      : null;

  const declaredWidth = svg.attrs["width"] !== undefined ? num(svg.attrs["width"]) : null;
  const declaredHeight = svg.attrs["height"] !== undefined ? num(svg.attrs["height"]) : null;

  // viewBox -> user space: translate the viewBox origin to 0,0 (uniform scale
  // to width/height is intentionally NOT applied; normalization rescales later).
  let rootMatrix: Matrix2D = IDENTITY;
  if (viewBox) rootMatrix = [1, 0, 0, 1, -viewBox.minX, -viewBox.minY];

  const visit = (node: XmlNode, parentMatrix: Matrix2D, parentStyle: StyleState) => {
    elementCounts[node.tag] = (elementCounts[node.tag] ?? 0) + 1;

    for (const key of Object.keys(node.attrs)) {
      if (key.startsWith("on")) warn("ACTIVE_CONTENT_STRIPPED", "Event handler attributes were ignored; SVG is imported as inert geometry.");
      const v = node.attrs[key] ?? "";
      if (/^\s*(https?:)?\/\//i.test(v) || /url\(\s*['"]?(https?:)?\/\//i.test(v)) {
        warn("REMOTE_RESOURCE_IGNORED", "References to remote resources were ignored; nothing is downloaded.");
      }
    }
    if (node.attrs["clip-path"]) {
      warn("CLIP_PATH_PARTIAL_SUPPORT", "clip-path is not applied; the generated formation may differ from the rendered artwork.");
    }
    if (node.attrs["mask"]) {
      warn("MASK_UNSUPPORTED", "mask is not supported; the generated formation may differ from the rendered artwork.");
    }
    if (node.attrs["filter"]) {
      warn("FILTER_UNSUPPORTED", "filter effects are ignored by the vector formation engine.");
    }

    switch (node.tag) {
      case "script":
      case "foreignobject":
      case "foreignObject":
      case "animate":
      case "animatetransform":
      case "set":
        warn("ACTIVE_CONTENT_STRIPPED", "Active SVG content (scripts/animation/foreignObject) was stripped and never executed.");
        return;
      case "text":
      case "tspan":
      case "textpath":
        warn(
          "LIVE_TEXT_PRESENT",
          "SVG contains live text. Convert text to paths for deterministic drone formation generation.",
        );
        return;
      case "image":
        warn(
          "RASTER_IMAGE_PRESENT",
          "Embedded raster images are not supported by the SVG vector formation engine.",
        );
        return;
      case "use":
        warn("UNSUPPORTED_GEOMETRY", "<use> references are not resolved in this version.");
        return;
      case "clippath":
        warn("CLIP_PATH_PARTIAL_SUPPORT", "clipPath definitions are detected but not applied.");
        return;
      case "mask":
        warn("MASK_UNSUPPORTED", "mask definitions are detected but not applied.");
        return;
      case "filter":
        warn("FILTER_UNSUPPORTED", "filter definitions are detected but not applied.");
        return;
      default:
        break;
    }

    if (IGNORED_TAGS.has(node.tag)) return;

    const { matrix: local, unsupported } = parseTransform(node.attrs["transform"]);
    if (unsupported.length > 0) {
      warn("UNSUPPORTED_TRANSFORM", `Unsupported transform function ignored: ${unsupported[0]}`);
    }
    const ctm = multiply(parentMatrix, local);
    const style = inheritStyle(parentStyle, node.attrs);
    const hidden = style.display.trim().toLowerCase() === "none" || style.opacity <= 0.001;

    if (GEOMETRY_TAGS.has(node.tag)) {
      if (hidden) return;
      const hasFill = !isNone(style.fill) && style.fillOpacity * style.opacity > 0.01;
      const hasStroke = !isNone(style.stroke) && style.strokeOpacity * style.opacity > 0.01;
      if (!hasFill && !hasStroke) return;
      const subs = shapeToSubPaths(node, warn);
      const tol = tolerance / matrixScale(ctm);
      for (const sub of subs) {
        const points = flattenSubPath(sub, ctm, tol);
        if (points.length < 2) continue;
        const closed = sub.closed && points.length >= 3;
        contours.push({
          id: `c${++contourSeq}`,
          source: node.tag,
          closed,
          points,
          length: polylineLength(points, closed),
          stroked: true,
          filled: hasFill && closed,
          fillRule: style.fillRule,
        });
      }
      return;
    }

    if (!CONTAINER_TAGS.has(node.tag)) {
      warn("UNSUPPORTED_GEOMETRY", `Unsupported element <${node.tag}> was skipped.`);
      return;
    }
    if (hidden) return;
    for (const child of node.children) visit(child, ctm, style);
  };

  visit(svg, rootMatrix, ROOT_STYLE);

  const usable = contours.filter((c) => c.length > 1e-6);
  if (usable.length === 0) {
    throw new SvgError(
      "NO_VISIBLE_GEOMETRY",
      "No visible vector geometry was found. Convert text to paths and make sure shapes have a fill or stroke.",
    );
  }

  const allPoints: Point2[] = [];
  for (const c of usable) for (const p of c.points) allPoints.push(p);

  const closedRegions = usable.filter((c) => c.closed && c.filled);
  if (closedRegions.length === 0) {
    warn("NO_FILLED_GEOMETRY", "No closed filled regions found — fill sampling is unavailable for this file.");
  }

  return {
    bounds: boundsOf(allPoints),
    contours: usable,
    closedRegions,
    sourceMetadata: {
      fileName: options.fileName ?? "untitled.svg",
      byteLength,
      viewBox,
      declaredWidth,
      declaredHeight,
      elementCounts,
    },
    warnings,
  };
}
