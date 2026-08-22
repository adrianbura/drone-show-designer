/**
 * DOCUMENT LIFECYCLE MATRIX — pure decision model.
 *
 * Covers the naming/identity rules of Save As, the operator feedback wording of
 * every lifecycle action, and the dirty-close guard contract shared with New /
 * Open / Load Sample / Restore.
 */
import { describe, expect, it } from "vitest";

import {
  NO_SHOW_OPEN_BODY,
  NO_SHOW_OPEN_TITLE,
  NO_SHOW_PRIMARY_ACTIONS,
  documentFeedback,
  saveAsFileName,
  suggestedSaveAsName,
} from "../documentLifecycle";
import { requiresUnsavedConfirmation, unsavedWorkPrompt } from "../unsavedWorkGuard";

describe("save as naming", () => {
  it("normalises a requested name to the project extension", () => {
    expect(saveAsFileName("wedding-final", "Show")).toBe("wedding-final.droneshow.json");
    expect(saveAsFileName("  keep.droneshow.json ", "Show")).toBe("keep.droneshow.json");
  });

  it("never writes an unnamed document: an empty request falls back to the project name", () => {
    const fallback = saveAsFileName("   ", "Two Hearts");
    expect(fallback.endsWith(".droneshow.json")).toBe(true);
    expect(fallback.length).toBeGreaterThan(".droneshow.json".length);
  });

  it("proposes a NEW identity instead of the current one", () => {
    const proposal = suggestedSaveAsName("wedding.droneshow.json", "Wedding");
    expect(proposal).toBe("wedding-copy.droneshow.json");
    expect(proposal).not.toBe("wedding.droneshow.json");
  });

  it("proposes a name even when the document has no file yet", () => {
    expect(suggestedSaveAsName("", "Wedding").endsWith(".json")).toBe(true);
  });
});

describe("document feedback", () => {
  it("labels every lifecycle action distinctly", () => {
    expect(documentFeedback("SAVED", "a.json").message).toBe("Saved: a.json");
    expect(documentFeedback("SAVED_AS", "b.json").message).toBe("Saved As: b.json");
    expect(documentFeedback("OPENED", "c.json").message).toBe("Opened: c.json");
    expect(documentFeedback("CLOSED", "c.json").message).toBe("Closed: c.json");
  });
});

describe("dirty close guard", () => {
  it("asks for consent before closing a dirty document", () => {
    expect(requiresUnsavedConfirmation("CLOSE_SHOW", { projectDirty: true })).toBe(true);
    expect(requiresUnsavedConfirmation("CLOSE_SHOW", { projectDirty: false })).toBe(false);
  });

  it("uses close-specific wording, not the generic replacement wording", () => {
    const close = unsavedWorkPrompt("CLOSE_SHOW");
    expect(close.continueLabel).toBe("Close without saving");
    expect(close.body).not.toBe(unsavedWorkPrompt("NEW_SHOW").body);
  });
});

describe("no show open state", () => {
  it("offers exactly the three lifecycle entry points", () => {
    expect([...NO_SHOW_PRIMARY_ACTIONS]).toEqual(["NEW_SHOW", "OPEN_PROJECT", "IMPORT_ESSP"]);
  });

  it("states the empty document explicitly", () => {
    expect(NO_SHOW_OPEN_TITLE).toBe("No show open");
    expect(NO_SHOW_OPEN_BODY).toContain("import an ESSP archive");
  });
});
