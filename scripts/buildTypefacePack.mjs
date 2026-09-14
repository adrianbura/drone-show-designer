/**
 * BUILD-TIME TYPEFACE PACK GENERATOR (developer tool, never shipped to runtime).
 *
 * Reads a real TTF, flattens each glyph outline into closed polylines in em
 * units (baseline y = 0, cap height normalised to CAP_HEIGHT) and emits a
 * generated, fully deterministic TypeScript glyph pack. The app NEVER parses a
 * font at runtime: flight geometry stays reproducible byte-for-byte.
 *
 * Usage: bun scripts/buildTypefacePack.mjs <font.ttf> <outFile.ts> <packId> <label>
 */
import { readFileSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";

const [, , fontPath, outPath, packId, label] = process.argv;
if (!fontPath || !outPath || !packId || !label) {
  console.error("usage: bun scripts/buildTypefacePack.mjs <font.ttf> <out.ts> <packId> <label>");
  process.exit(1);
}

const CAP_HEIGHT = 7;
const CHARSET = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-!?"];
const SEGMENTS = 10; // quadratic/cubic flattening steps (fixed => deterministic)
const PRECISION = 4;

const font = opentype.parse(readFileSync(fontPath).buffer);
const capHeightUnits =
  font.tables.os2?.sCapHeight || font.tables.os2?.sTypoAscender || font.unitsPerEm * 0.7;
const scale = CAP_HEIGHT / capHeightUnits;
const round = (v) => Number(v.toFixed(PRECISION));

function quad(p0, p1, p2, out) {
  for (let i = 1; i <= SEGMENTS; i += 1) {
    const t = i / SEGMENTS;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
}

function cubic(p0, p1, p2, p3, out) {
  for (let i = 1; i <= SEGMENTS; i += 1) {
    const t = i / SEGMENTS;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

function contoursOf(character) {
  const glyph = font.charToGlyph(character);
  const path = glyph.getPath(0, 0, font.unitsPerEm);
  // getPath scales to the requested font size; normalise back to font units.
  const back = 1 / 1;
  const contours = [];
  let current = null;
  let cursor = [0, 0];
  for (const cmd of path.commands) {
    if (cmd.type === "M") {
      if (current && current.length > 2) contours.push(current);
      current = [[cmd.x * back, cmd.y * back]];
      cursor = [cmd.x, cmd.y];
    } else if (cmd.type === "L") {
      current?.push([cmd.x * back, cmd.y * back]);
      cursor = [cmd.x, cmd.y];
    } else if (cmd.type === "Q") {
      quad(cursor, [cmd.x1, cmd.y1], [cmd.x, cmd.y], current ?? []);
      cursor = [cmd.x, cmd.y];
    } else if (cmd.type === "C") {
      cubic(cursor, [cmd.x1, cmd.y1], [cmd.x2, cmd.y2], [cmd.x, cmd.y], current ?? []);
      cursor = [cmd.x, cmd.y];
    } else if (cmd.type === "Z") {
      if (current && current.length > 2) contours.push(current);
      current = null;
    }
  }
  if (current && current.length > 2) contours.push(current);
  return {
    advance: (glyph.advanceWidth / font.unitsPerEm) * font.unitsPerEm,
    contours,
  };
}

const entries = [];
for (const character of CHARSET) {
  const { advance, contours } = contoursOf(character);
  if (contours.length === 0) {
    console.error(`missing outline for ${character}`);
    process.exit(1);
  }
  const strokes = contours.map((contour) => {
    // opentype paths are y-down; flight geometry is y-up.
    const pts = contour.map(([x, y]) => [round(x * scale), round(-y * scale)]);
    // Drop a duplicated closing vertex; the generator closes contours itself.
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first && last && first[0] === last[0] && first[1] === last[1]) pts.pop();
    return pts;
  });
  entries.push({
    character,
    advance: round((advance / font.unitsPerEm) * (font.unitsPerEm * scale)),
    strokes,
  });
}

const spaceAdvance = round(
  (font.charToGlyph(" ").advanceWidth / font.unitsPerEm) * (font.unitsPerEm * scale),
);

const body = entries
  .map(
    (entry) =>
      `  ${JSON.stringify(entry.character)}: { advance: ${entry.advance}, strokes: [${entry.strokes
        .map((stroke) => `[${stroke.map((p) => `[${p[0]},${p[1]}]`).join(",")}]`)
        .join(",")}] },`,
  )
  .join("\n");

const source = `/**
 * GENERATED FILE — do not edit by hand.
 * Produced by scripts/buildTypefacePack.mjs from a real TTF outline set.
 *
 * Closed glyph contours in em units, baseline y = 0, cap height = ${CAP_HEIGHT}.
 * The font itself is NOT shipped or parsed at runtime, so text flight geometry
 * stays deterministic on every machine, browser and export host.
 */
import type { GlyphPackDefinition } from "./glyphPack";

export const ${packId.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_PACK: GlyphPackDefinition = {
  id: ${JSON.stringify(packId)},
  version: 1,
  label: ${JSON.stringify(label)},
  capHeight: ${CAP_HEIGHT},
  closedContours: true,
  glyphs: {
  " ": { advance: ${spaceAdvance}, strokes: [] },
${body}
  },
};
`;

writeFileSync(outPath, source);
console.error(`wrote ${outPath} (${entries.length} glyphs)`);
