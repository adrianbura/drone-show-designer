import { describe, expect, it } from "vitest";

import {
  documentDirty,
  requiresUnsavedConfirmation,
  unsavedWorkPrompt,
  type DestructiveDocumentAction,
} from "../unsavedWorkGuard";

const ACTIONS: DestructiveDocumentAction[] = [
  "NEW_SHOW",
  "OPEN_PROJECT",
  "LOAD_SAMPLE",
  "RESTORE_AUTOSAVE",
];

describe("unsaved work guard", () => {
  it("prompts for every destructive replacement when the document is dirty", () => {
    for (const action of ACTIONS) {
      expect(requiresUnsavedConfirmation(action, { projectDirty: true })).toBe(true);
    }
  });

  it("never prompts for a clean document", () => {
    for (const action of ACTIONS) {
      expect(requiresUnsavedConfirmation(action, { projectDirty: false })).toBe(false);
    }
  });

  it("states what happens and offers a continue-without-saving choice", () => {
    for (const action of ACTIONS) {
      const prompt = unsavedWorkPrompt(action);
      expect(prompt.action).toBe(action);
      expect(prompt.body).toMatch(/never saved/i);
      expect(prompt.body).toMatch(/replaces it/i);
      expect(prompt.continueLabel).toMatch(/without saving/i);
    }
  });
});

describe("dirty tracking rule", () => {
  it("treats an unanchored document as clean", () => {
    expect(documentDirty(null, "{}")).toBe(false);
  });

  it("marks edits to a never-saved but anchored document as unsaved work", () => {
    const baseline = JSON.stringify({ name: "Untitled Show" });
    expect(documentDirty(baseline, baseline)).toBe(false);
    expect(documentDirty(baseline, JSON.stringify({ name: "Two Hearts, One Sky" }))).toBe(true);
  });

  it("lands back on clean when an edit is undone", () => {
    const baseline = JSON.stringify({ name: "A" });
    expect(documentDirty(baseline, JSON.stringify({ name: "B" }))).toBe(true);
    expect(documentDirty(baseline, JSON.stringify({ name: "A" }))).toBe(false);
  });

  it("keeps a recovered document dirty against the empty signature", () => {
    expect(documentDirty("", JSON.stringify({ name: "A" }))).toBe(true);
  });
});
