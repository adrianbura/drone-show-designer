// @vitest-environment jsdom
/**
 * STUDIO CONTEXT MENU — REAL DOM CONTRACT.
 *
 * Pure state-machine tests cannot expose the actual failure mode we hit in the
 * browser: Radix renders menu content in a PORTAL, but that content is still a
 * REACT child of whatever wraps the trigger, so synthetic pointer events from a
 * menu item bubble into the owning surface. The timeline track reacted by taking
 * pointer capture, which retargeted the following pointerup/click away from the
 * item — so Radix never activated it and every menu action looked dead.
 *
 * This test reproduces that exact topology (capture-taking ancestor around the
 * trigger) and pins the contract:
 *  - opening right-click never invokes a command
 *  - an immediate pointer click on a top-level item invokes it exactly once
 *  - submenu pointer navigation + activation works
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import StudioContextMenu from "@/components/studio/StudioContextMenu";
import type { StudioCommandMenu } from "@/lib/studio/commands";
import { isInsideMenuSurface } from "@/lib/studio/menuSurface";

const MENU: StudioCommandMenu = {
  title: "Clip · takeoff",
  sections: [
    { id: "primary", items: [{ id: "EDIT_FORMATION", label: "Edit formation", available: true }] },
    {
      id: "LIGHTING",
      label: "Lighting",
      items: [{ id: "EDIT_LIGHTING", label: "Edit lighting…", available: true }],
    },
    { id: "meta", items: [{ id: "RENAME_CLIP", label: "Rename clip…", available: true }] },
  ],
};

function pointer(el: Element, type: string, init: PointerEventInit = {}) {
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }) as PointerEvent,
  );
}

function Harness({ onCommand }: { onCommand: (id: string) => void }) {
  // Mirrors the timeline track: a capture-taking ancestor around the trigger.
  return (
    <div
      data-testid="surface"
      onPointerDown={(e) => {
        if (isInsideMenuSurface(e.target)) return;
        (e.currentTarget as HTMLElement).setAttribute("data-captured", "true");
      }}
    >
      <StudioContextMenu menu={MENU} onCommand={(id) => onCommand(id)} asChild={false}>
        <div data-testid="clip">takeoff</div>
      </StudioContextMenu>
    </div>
  );
}

afterEach(cleanup);

describe("StudioContextMenu in the DOM", () => {
  it("the opening right-click sequence invokes nothing and leaves the menu open", async () => {
    const onCommand = vi.fn();
    render(<Harness onCommand={onCommand} />);
    const trigger = screen.getByTestId("clip");
    // Real ordering for a mouse: the right-button release completes BEFORE the
    // browser fires `contextmenu`, so no item exists yet to receive it.
    pointer(trigger, "pointerdown", { button: 2 });
    pointer(trigger, "pointerup", { button: 2 });
    trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    await waitFor(() => expect(screen.getByTestId("studio-context-menu")).toBeTruthy());
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId("studio-context-menu")).toBeTruthy();
  });


  it("an immediate pointer click on a top-level item invokes it exactly once", async () => {
    const onCommand = vi.fn();
    render(<Harness onCommand={onCommand} />);
    const trigger = screen.getByTestId("clip");
    trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    await waitFor(() => expect(screen.getByTestId("studio-context-menu")).toBeTruthy());
    const item = screen.getByTestId("ctx-RENAME_CLIP");
    pointer(item, "pointerdown");
    // The capture-taking ancestor must ignore pointer events from the menu.
    expect(screen.getByTestId("surface").getAttribute("data-captured")).toBeNull();
    pointer(item, "pointerup");
    pointer(item, "click");
    await waitFor(() => expect(onCommand).toHaveBeenCalledTimes(1));
    expect(onCommand).toHaveBeenCalledWith("RENAME_CLIP");
  });

  it("submenu items activate through pointer interaction", async () => {
    const onCommand = vi.fn();
    render(<Harness onCommand={onCommand} />);
    const trigger = screen.getByTestId("clip");
    trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    await waitFor(() => expect(screen.getByTestId("studio-context-menu")).toBeTruthy());
    const sub = screen.getByTestId("ctx-sub-LIGHTING");
    pointer(sub, "pointerover");
    pointer(sub, "pointermove");
    pointer(sub, "click");
    const item = await waitFor(() => screen.getByTestId("ctx-EDIT_LIGHTING"));
    pointer(item, "pointerdown");
    expect(screen.getByTestId("surface").getAttribute("data-captured")).toBeNull();
    pointer(item, "pointerup");
    pointer(item, "click");
    await waitFor(() => expect(onCommand).toHaveBeenCalledTimes(1));
    expect(onCommand).toHaveBeenCalledWith("EDIT_LIGHTING");
  });
});
