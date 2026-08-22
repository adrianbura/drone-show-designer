import { describe, expect, it } from "vitest";

import {
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
