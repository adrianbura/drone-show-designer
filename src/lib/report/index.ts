/**
 * VALIDATION REPORT — public surface.
 *
 * Pure and framework free: a document model built from facts other authorities
 * already computed, plus a dependency-free PDF renderer.
 */
export * from "./types";
export * from "./validationReport";
export { renderValidationReportPdf } from "./render";
export { writePdf, PAGE_WIDTH, PAGE_HEIGHT, measureText, wrapText, clampText } from "./pdf";
export type { PdfOp, PdfPage } from "./pdf";
