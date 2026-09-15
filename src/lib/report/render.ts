/**
 * VALIDATION REPORT LAYOUT — document model -> PDF drawing commands.
 *
 * Presentation only: it lays out and paginates the pure document model. It never
 * reads project state, never computes facts and never mutates anything.
 */
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  clampText,
  wrapText,
  writePdf,
  type PdfOp,
  type PdfPage,
} from "./pdf";
import type { ValidationReportDocument } from "./types";

const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BODY_SIZE = 8.5;
const LINE = 12;

class Layout {
  private pages: PdfOp[][] = [[]];
  private y = PAGE_HEIGHT - MARGIN;

  get page(): PdfOp[] {
    return this.pages[this.pages.length - 1]!;
  }

  need(height: number) {
    if (this.y - height < MARGIN + 28) {
      this.pages.push([]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  cursor(): number {
    return this.y;
  }

  advance(height: number) {
    this.y -= height;
  }

  text(text: string, x: number, size: number, bold = false, gray = 0) {
    this.page.push({ kind: "text", x, y: this.y, size, bold, gray, text });
  }

  op(op: PdfOp) {
    this.page.push(op);
  }

  finish(doc: ValidationReportDocument): PdfPage[] {
    const total = this.pages.length;
    return this.pages.map((ops, index) => ({
      ops: [
        ...ops,
        {
          kind: "line" as const,
          x1: MARGIN,
          y1: MARGIN + 18,
          x2: PAGE_WIDTH - MARGIN,
          y2: MARGIN + 18,
          gray: 0.75,
        },
        {
          kind: "text" as const,
          x: MARGIN,
          y: MARGIN + 6,
          size: 7,
          gray: 0.4,
          text: `${doc.title} · generated ${doc.generatedAt} · not a flight authorisation`,
        },
        {
          kind: "text" as const,
          x: PAGE_WIDTH - MARGIN - 46,
          y: MARGIN + 6,
          size: 7,
          gray: 0.4,
          text: `page ${index + 1} / ${total}`,
        },
      ],
    }));
  }
}

function paragraph(layout: Layout, text: string, size: number, bold = false, gray = 0) {
  for (const line of wrapText(text, size, CONTENT_WIDTH, bold)) {
    layout.need(LINE);
    layout.text(line, MARGIN, size, bold, gray);
    layout.advance(size + 3.5);
  }
}

function facts(layout: Layout, rows: readonly { label: string; value: string }[]) {
  const labelWidth = 150;
  for (const row of rows) {
    const valueLines = wrapText(row.value, BODY_SIZE, CONTENT_WIDTH - labelWidth - 8);
    layout.need(LINE * valueLines.length);
    layout.text(clampText(row.label, BODY_SIZE, labelWidth, true), MARGIN, BODY_SIZE, true);
    valueLines.forEach((line, index) => {
      if (index > 0) layout.advance(LINE);
      layout.text(line, MARGIN + labelWidth, BODY_SIZE);
    });
    layout.advance(LINE);
  }
  layout.advance(4);
}

function table(layout: Layout, columns: readonly string[], rows: readonly (readonly string[])[]) {
  const count = Math.max(1, columns.length);
  const first = count > 2 ? CONTENT_WIDTH * 0.3 : CONTENT_WIDTH / count;
  const rest = (CONTENT_WIDTH - first) / Math.max(1, count - 1);
  const widths = columns.map((_, i) => (i === 0 ? first : rest));
  const drawHeader = () => {
    layout.need(LINE * 2);
    let x = MARGIN;
    columns.forEach((column, index) => {
      layout.text(clampText(column, 7.5, widths[index]! - 6, true), x, 7.5, true, 0.35);
      x += widths[index]!;
    });
    layout.advance(4);
    layout.op({
      kind: "line",
      x1: MARGIN,
      y1: layout.cursor() + 3,
      x2: PAGE_WIDTH - MARGIN,
      y2: layout.cursor() + 3,
      gray: 0.7,
    });
    layout.advance(LINE - 1);
  };
  drawHeader();
  for (const row of rows) {
    layout.need(LINE);
    let x = MARGIN;
    row.forEach((cell, index) => {
      const width = widths[index] ?? rest;
      layout.text(clampText(cell, BODY_SIZE, width - 6), x, BODY_SIZE);
      x += width;
    });
    layout.advance(LINE);
  }
  layout.advance(6);
}

function bars(
  layout: Layout,
  unit: string,
  items: readonly { label: string; value: number; danger?: boolean }[],
  reference?: { label: string; value: number },
) {
  if (items.length === 0) return;
  const labelWidth = 96;
  const chartWidth = CONTENT_WIDTH - labelWidth - 60;
  const max = Math.max(
    reference?.value ?? 0,
    ...items.map((i) => (Number.isFinite(i.value) ? i.value : 0)),
    1,
  );
  const rowHeight = 14;
  layout.need(rowHeight * items.length + 22);
  for (const item of items) {
    const value = Number.isFinite(item.value) ? Math.max(0, item.value) : 0;
    const width = (value / max) * chartWidth;
    layout.text(clampText(item.label, 7.5, labelWidth - 6), MARGIN, 7.5);
    layout.op({
      kind: "rect",
      x: MARGIN + labelWidth,
      y: layout.cursor() - 1.5,
      w: Math.max(0.6, width),
      h: 7,
      gray: item.danger ? 0.15 : 0.55,
    });
    layout.text(
      `${value.toFixed(2)} ${unit}`,
      MARGIN + labelWidth + chartWidth + 6,
      7.5,
      false,
      0.3,
    );
    layout.advance(rowHeight);
  }
  if (reference) {
    layout.text(`Reference: ${reference.label}`, MARGIN + labelWidth, 7, false, 0.3);
    layout.advance(LINE);
  }
  layout.advance(4);
}

function list(layout: Layout, items: readonly string[]) {
  for (const item of items) {
    const lines = wrapText(item, BODY_SIZE, CONTENT_WIDTH - 12);
    lines.forEach((line, index) => {
      layout.need(LINE);
      if (index === 0) layout.text("•", MARGIN, BODY_SIZE, false, 0.4);
      layout.text(line, MARGIN + 12, BODY_SIZE);
      layout.advance(LINE);
    });
  }
  layout.advance(4);
}

/** Renders the document model to PDF bytes. */
export function renderValidationReportPdf(doc: ValidationReportDocument): Uint8Array {
  const layout = new Layout();

  layout.text(clampText(doc.title, 16, CONTENT_WIDTH, true), MARGIN, 16, true);
  layout.advance(20);
  layout.text(doc.subtitle, MARGIN, 9.5, false, 0.35);
  layout.advance(14);
  layout.text(`Generated ${doc.generatedAt}`, MARGIN, 8, false, 0.45);
  layout.advance(18);

  layout.op({
    kind: "rect",
    x: MARGIN,
    y: layout.cursor() - 6,
    w: CONTENT_WIDTH,
    h: 22,
    gray: 0.9,
  });
  layout.text(doc.status.replace(/_/g, " "), MARGIN + 8, 11, true);
  layout.advance(20);
  paragraph(layout, doc.statusDetail, BODY_SIZE, false, 0.2);
  layout.advance(8);

  for (const section of doc.sections) {
    layout.need(LINE * 6);
    layout.text(clampText(section.title, 11, CONTENT_WIDTH, true), MARGIN, 11, true);
    layout.advance(6);
    layout.op({
      kind: "line",
      x1: MARGIN,
      y1: layout.cursor() + 3,
      x2: PAGE_WIDTH - MARGIN,
      y2: layout.cursor() + 3,
      gray: 0.6,
    });
    layout.advance(LINE);
    for (const block of section.blocks) {
      if (block.kind === "facts") facts(layout, block.facts as { label: string; value: string }[]);
      else if (block.kind === "table") table(layout, block.table.columns, block.table.rows);
      else if (block.kind === "bars")
        bars(layout, block.unit, block.bars, block.reference ? { ...block.reference } : undefined);
      else if (block.kind === "list") list(layout, block.items);
      else paragraph(layout, block.text, BODY_SIZE, false, 0.3);
    }
    layout.advance(6);
  }

  layout.need(LINE * 4);
  layout.text("Disclaimer", MARGIN, 10, true);
  layout.advance(LINE);
  paragraph(layout, doc.disclaimer, 8, false, 0.15);

  return writePdf(layout.finish(doc), doc.title);
}
