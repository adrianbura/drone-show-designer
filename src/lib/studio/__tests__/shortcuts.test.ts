import { describe, expect, it } from "vitest";

import { isTextEntryTarget, resolveShortcut } from "../shortcuts";

describe("keyboard shortcuts", () => {
  it("toggles playback on Space", () => {
    expect(resolveShortcut({ key: " " })).toEqual({ type: "togglePlay" });
    expect(resolveShortcut({ key: "k" })).toEqual({ type: "togglePlay" });
  });

  it("never steals keys from text entry", () => {
    expect(isTextEntryTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextEntryTarget({ tagName: "DIV" })).toBe(false);
    expect(resolveShortcut({ key: " ", target: { tagName: "INPUT" } })).toBeNull();
    expect(resolveShortcut({ key: " ", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(resolveShortcut({ key: "z", ctrlKey: true, target: { tagName: "INPUT" } })).toBeNull();
  });

  it("seeks with arrows and jumps with Home/End", () => {
    expect(resolveShortcut({ key: "ArrowRight" })).toEqual({ type: "seek", delta: 1 });
    expect(resolveShortcut({ key: "ArrowLeft", shiftKey: true })).toEqual({ type: "seek", delta: -5 });
    expect(resolveShortcut({ key: "Home" })).toEqual({ type: "seekStart" });
    expect(resolveShortcut({ key: "End" })).toEqual({ type: "seekEnd" });
  });

  it("maps undo / redo and escape", () => {
    expect(resolveShortcut({ key: "z", metaKey: true })).toEqual({ type: "undo" });
    expect(resolveShortcut({ key: "Z", ctrlKey: true, shiftKey: true })).toEqual({ type: "redo" });
    expect(resolveShortcut({ key: "y", ctrlKey: true })).toEqual({ type: "redo" });
    expect(resolveShortcut({ key: "Escape" })).toEqual({ type: "clearSelection" });
  });

  it("ignores unrelated keys", () => {
    expect(resolveShortcut({ key: "q" })).toBeNull();
    expect(resolveShortcut({ key: "s", ctrlKey: true })).toBeNull();
  });
});
