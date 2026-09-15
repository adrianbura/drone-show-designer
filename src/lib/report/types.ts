/**
 * VALIDATION REPORT — document model (pure).
 *
 * A printable projection of facts that other authorities already computed
 * (`fullshow` validation + `geo` geofence scan + project limits). Nothing here
 * computes safety, geometry or geofence facts, and nothing here mutates state.
 */

export interface ReportFact {
  readonly label: string;
  readonly value: string;
}

export interface ReportTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface ReportBar {
  readonly label: string;
  readonly value: number;
  /** Marks a bar that breaches the reference line. Presentation only. */
  readonly danger?: boolean;
}

export type ReportBlock =
  | { readonly kind: "facts"; readonly facts: readonly ReportFact[] }
  | { readonly kind: "table"; readonly table: ReportTable }
  | {
      readonly kind: "bars";
      readonly unit: string;
      readonly bars: readonly ReportBar[];
      readonly reference?: { readonly label: string; readonly value: number };
    }
  | { readonly kind: "list"; readonly items: readonly string[] }
  | { readonly kind: "note"; readonly text: string };

export interface ReportSection {
  readonly title: string;
  readonly blocks: readonly ReportBlock[];
}

export type ValidationReportStatus = "PASS" | "PASS_WITH_WARNINGS" | "FAIL";

export interface ValidationReportDocument {
  readonly title: string;
  readonly subtitle: string;
  /** ISO-8601 instant supplied by the caller; the builder never reads the clock. */
  readonly generatedAt: string;
  readonly status: ValidationReportStatus;
  readonly statusDetail: string;
  readonly sections: readonly ReportSection[];
  /** Always rendered, always last: the document does not authorise any flight. */
  readonly disclaimer: string;
}

export const VALIDATION_REPORT_DISCLAIMER =
  "This document reports the result of automated checks on a designed show. " +
  "It is not a flight authorisation, not an airspace clearance and not a legal " +
  "permit. Responsibility for authorisation, airworthiness and safe operation " +
  "remains entirely with the operator.";
