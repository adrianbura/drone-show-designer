/**
 * CONTEXT MENU OPENING-GESTURE CONTRACT.
 *
 * The release of the right-click / long-press that opened the menu must not
 * activate an item. Every later pointer gesture — including one issued in the
 * same millisecond — must activate normally: no time window exists.
 */
import { describe, expect, it } from "vitest";

import {
  armOpeningGesture,
  beginNewPointer,
  handleClick,
  handlePointerUp,
  IDLE_GESTURE,
  opensContextMenu,
} from "../contextMenuGesture";

describe("context menu opening gesture", () => {
  it("suppresses the opening release landing in the menu, and its synthesized click", () => {
    let state = armOpeningGesture({ button: 2, pointerType: "mouse" });
    const up = handlePointerUp(state, { insideMenu: true });
    expect(up.suppress).toBe(true);
    state = up.state;
    const click = handleClick(state);
    expect(click.suppress).toBe(true);
    expect(click.state).toEqual(IDLE_GESTURE);
  });

  it("does not suppress the opening release when it lands outside any menu", () => {
    const state = armOpeningGesture({ button: 2, pointerType: "mouse" });
    const up = handlePointerUp(state, { insideMenu: false });
    expect(up.suppress).toBe(false);
    expect(handleClick(up.state).suppress).toBe(false);
  });

  it("lets an immediate intentional click activate an item", () => {
    armOpeningGesture({ button: 2, pointerType: "mouse" });
    // Any new pointerdown (item or submenu item) clears suppression at once.
    let state = beginNewPointer();
    const up = handlePointerUp(state, { insideMenu: true });
    expect(up.suppress).toBe(false);
    state = up.state;
    expect(handleClick(state).suppress).toBe(false);
  });

  it("suppresses at most one release — a second release always passes", () => {
    const first = handlePointerUp(armOpeningGesture({ button: 2 }), { insideMenu: true });
    expect(first.suppress).toBe(true);
    const afterClick = handleClick(first.state);
    expect(handlePointerUp(afterClick.state, { insideMenu: true }).suppress).toBe(false);
  });

  it("only right button, touch and pen open a context menu", () => {
    expect(opensContextMenu({ button: 2, pointerType: "mouse" })).toBe(true);
    expect(opensContextMenu({ button: 0, pointerType: "touch" })).toBe(true);
    expect(opensContextMenu({ button: 0, pointerType: "pen" })).toBe(true);
    expect(opensContextMenu({ button: 0, pointerType: "mouse" })).toBe(false);
    expect(armOpeningGesture({ button: 0, pointerType: "mouse" })).toEqual(IDLE_GESTURE);
  });

  it("leaves keyboard activation untouched — a click with no armed release passes", () => {
    expect(handleClick(IDLE_GESTURE).suppress).toBe(false);
  });
});
