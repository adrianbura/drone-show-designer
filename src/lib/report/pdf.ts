/**
 * MINIMAL PDF WRITER (pure, dependency free).
 *
 * Emits a valid PDF 1.4 byte stream from a small drawing-command list. Scope is
 * deliberately narrow: WinAnsi text in the two standard Helvetica faces, plus
 * lines and filled rectangles — exactly what the validation report needs. No
 * images, no embedded fonts, no compression. Deterministic for identical input.
 */

export type PdfOp =
  | {
      readonly kind: "text";
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly bold?: boolean;
      readonly gray?: number;
      readonly text: string;
    }
  | {
      readonly kind: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly width?: number;
      readonly gray?: number;
    }
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly gray?: number;
    };

export interface PdfPage {
  readonly ops: readonly PdfOp[];
}

/** A4 in PostScript points. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

const num = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0).toString();

/** Latin-1 (WinAnsi) escaping. Characters outside the range degrade to "?". */
export function escapePdfText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?";
  }
  return out;
}

/** Helvetica advance widths, 1000-unit em. Enough for layout measurement. */
const WIDTHS: Record<string, number> = {
  " ": 278,
  "!": 278,
  '"': 355,
  "#": 556,
  $: 556,
  "%": 889,
  "&": 667,
  "'": 191,
  "(": 333,
  ")": 333,
  "*": 389,
  "+": 584,
  ",": 278,
  "-": 333,
  ".": 278,
  "/": 278,
  ":": 278,
  ";": 278,
  "<": 584,
  "=": 584,
  ">": 584,
  "?": 556,
  "@": 1015,
  "[": 278,
  "\\": 278,
  "]": 278,
  "^": 469,
  _: 556,
  "`": 333,
  "{": 334,
  "|": 260,
  "}": 334,
  "~": 584,
};
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const UPPER_WIDTHS = [
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
  611, 722, 667, 944, 667, 667, 611,
];
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const LOWER_WIDTHS = [
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500,
];

function charWidth(ch: string): number {
  if (ch >= "0" && ch <= "9") return 556;
  const upper = UPPER.indexOf(ch);
  if (upper >= 0) return UPPER_WIDTHS[upper]!;
  const lower = LOWER.indexOf(ch);
  if (lower >= 0) return LOWER_WIDTHS[lower]!;
  return WIDTHS[ch] ?? 556;
}

/** Text width in points. Bold is approximated at +6 %, good enough for layout. */
export function measureText(text: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of text) units += charWidth(ch);
  return (units / 1000) * size * (bold ? 1.06 : 1);
}

/** Hard-wraps a string to a pixel width, breaking on spaces where possible. */
export function wrapText(text: string, size: number, maxWidth: number, bold = false): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(candidate, size, bold) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Truncates with an ellipsis so a cell never overflows its column. */
export function clampText(text: string, size: number, maxWidth: number, bold = false): string {
  if (measureText(text, size, bold) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && measureText(`${out}...`, size, bold) > maxWidth) out = out.slice(0, -1);
  return `${out}...`;
}

function pageContent(page: PdfPage): string {
  const parts: string[] = [];
  for (const op of page.ops) {
    if (op.kind === "text") {
      const gray = op.gray ?? 0;
      parts.push(
        `BT /${op.bold ? "F2" : "F1"} ${num(op.size)} Tf ${num(gray)} g ${num(op.x)} ${num(op.y)} Td (${escapePdfText(op.text)}) Tj ET`,
      );
    } else if (op.kind === "line") {
      parts.push(
        `${num(op.gray ?? 0)} G ${num(op.width ?? 0.6)} w ${num(op.x1)} ${num(op.y1)} m ${num(op.x2)} ${num(op.y2)} l S`,
      );
    } else {
      parts.push(`${num(op.gray ?? 0)} g ${num(op.x)} ${num(op.y)} ${num(op.w)} ${num(op.h)} re f`);
    }
  }
  return parts.join("\n");
}

/** Serialises pages into PDF bytes. */
export function writePdf(pages: readonly PdfPage[], title = "Report"): Uint8Array {
  const safePages = pages.length > 0 ? pages : [{ ops: [] as PdfOp[] }];
  const objects: string[] = [];
  const push = (body: string) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  const fontRegular = push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const fontBold = push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const infoObj = push(`<< /Title (${escapePdfText(title)}) /Producer (Drone Show Studio) >>`);

  // Reserve the pages-tree object number so page objects can reference it.
  const pagesObj = push("");
  const pageObjNumbers: number[] = [];
  for (const page of safePages) {
    const content = pageContent(page);
    const streamObj = push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    pageObjNumbers.push(
      push(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] ` +
          `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${streamObj} 0 R >>`,
      ),
    );
  }
  objects[pagesObj - 1] =
    `<< /Type /Pages /Count ${pageObjNumbers.length} /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(" ")}] >>`;
  const catalogObj = push(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
