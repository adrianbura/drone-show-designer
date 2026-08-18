/**
 * DETERMINISTIC MOCK VISUAL REFERENCE PROVIDER.
 *
 * Used by tests and by any environment without an AI gateway: it performs NO
 * network call and no paid AI call, and always returns the same bytes for the
 * same request. It renders a bold synthetic silhouette raster with a pure-TS PNG
 * encoder so the full 8B1 -> 8B2 -> compiler pipeline can be exercised offline.
 */
import { buildReferencePrompt } from "./enrich";
import { parseRefineInstruction } from "./refine";
import {
  VisualReferenceError,
  type GenerateVisualReferenceRequest,
  type VisualReferenceProvider,
  type VisualReferenceResult,
} from "./types";

const SIZE = 256;

/* ---------------------------------------------------------------- PNG encoder */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/** Stored (uncompressed) zlib stream — valid deflate, no dependency needed. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  const MAX = 0xffff;
  for (let offset = 0; offset < raw.length; offset += MAX) {
    const slice = raw.subarray(offset, Math.min(raw.length, offset + MAX));
    const last = offset + MAX >= raw.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = last;
    header[1] = slice.length & 0xff;
    header[2] = (slice.length >> 8) & 0xff;
    header[3] = ~slice.length & 0xff;
    header[4] = (~slice.length >> 8) & 0xff;
    blocks.push(header, slice);
  }
  const total = blocks.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(2 + total + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let cursor = 2;
  for (const b of blocks) {
    out.set(b, cursor);
    cursor += b.length;
  }
  out.set(u32(adler32(raw)), cursor);
  return out;
}

/** Encodes an 8-bit greyscale raster (width*height) as a PNG. */
export function encodeGreyPng(width: number, height: number, grey: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0; // filter: none
    raw.set(grey.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa === "function") return btoa(binary);
  // Node / test environment.
  return Buffer.from(bytes).toString("base64");
}

/* ------------------------------------------------------------ synthetic shape */

/**
 * Draws a bold winged silhouette (dark subject on white) whose wing span grows
 * with the requested prompt directives. Pure maths — deterministic per request.
 */
function renderSilhouette(wingScale: number, headScale: number): Uint8Array {
  const grey = new Uint8Array(SIZE * SIZE).fill(255);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const set = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= SIZE || yi >= SIZE) return;
    grey[yi * SIZE + xi] = 20;
  };
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dx = (x - cx) / SIZE;
      const dy = (y - cy) / SIZE;
      // Body: vertical ellipse.
      const body = (dx * dx) / 0.006 + (dy * dy) / 0.05 <= 1;
      // Wings: two mirrored ellipses widening with wingScale.
      const wx = Math.abs(dx) - 0.16 * wingScale;
      const wing =
        (wx * wx) / (0.02 * wingScale * wingScale) + ((dy + 0.05) * (dy + 0.05)) / 0.006 <= 1;
      // Head: circle above the body.
      const hy = dy + 0.2;
      const head = (dx * dx + hy * hy) / (0.0035 * headScale * headScale) <= 1;
      if (body || wing || head) set(x, y);
    }
  }
  return grey;
}

export class MockVisualReferenceProvider implements VisualReferenceProvider {
  readonly id = "mock-visual";
  readonly label = "Deterministic mock";
  readonly model = "mock/silhouette-v1";

  async generate(request: GenerateVisualReferenceRequest): Promise<VisualReferenceResult> {
    if (request.prompt.trim().length === 0) {
      throw new VisualReferenceError("EMPTY_PROMPT", "The prompt is empty");
    }
    const directives = request.instruction ? parseRefineInstruction(request.instruction) : [];
    const enriched = buildReferencePrompt({
      prompt: request.prompt,
      droneCount: request.droneCount,
      style: request.style,
      directives,
    });
    const wider = directives.some((d) => d.includes("wider") || d.includes("open the wings"));
    const biggerHead = directives.some((d) => d.includes("enlarge the head"));
    const png = encodeGreyPng(
      SIZE,
      SIZE,
      renderSilhouette(wider ? 1.35 : 1, biggerHead ? 1.5 : 1),
    );
    return {
      imageBase64: toBase64(png),
      mimeType: "image/png",
      enrichedPrompt: enriched.text,
      providerId: this.id,
      providerLabel: this.label,
      model: this.model,
      usedContext: request.context !== undefined,
      // Deterministic: mock output never depends on wall-clock content.
      createdAt: "1970-01-01T00:00:00.000Z",
    };
  }
}

export const mockVisualReferenceProvider = new MockVisualReferenceProvider();
