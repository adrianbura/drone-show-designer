/**
 * STUDIO CONTEXT MENU (presentation only).
 *
 * Renders a `StudioCommandMenu` produced by the single command authority
 * (`src/lib/studio/commands.ts`) on top of the existing shadcn/Radix context
 * menu primitive. It contains ZERO availability rules and ZERO mutations: the
 * owner passes `onCommand`, which dispatches into the canonical store actions.
 *
 * Radix gives us keyboard navigation, Escape-to-close, focus return and
 * collision-aware repositioning (menus reposition instead of clipping in small
 * windows), so none of that is re-implemented here.
 */
import { useEffect, useRef, type ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { StudioCommand, StudioCommandId, StudioCommandMenu } from "@/lib/studio/commands";
import { opensContextMenu, suppressOpeningRelease } from "@/lib/studio/contextMenuGesture";

function Item({
  command,
  onCommand,
}: {
  command: StudioCommand;
  onCommand: (id: StudioCommandId) => void;
}) {
  return (
    <ContextMenuItem
      disabled={!command.available}
      {...(command.unavailableReason ? { title: command.unavailableReason } : {})}
      data-testid={`ctx-${command.id}`}
      onSelect={() => onCommand(command.id)}
      className={`text-xs ${command.destructive ? "text-destructive focus:text-destructive" : ""}`}
    >
      {command.label}
      {command.shortcut ? <ContextMenuShortcut>{command.shortcut}</ContextMenuShortcut> : null}
    </ContextMenuItem>
  );
}

export default function StudioContextMenu({
  menu,
  onCommand,
  onOpenChange,
  children,
  asChild = true,
}: {
  menu: StudioCommandMenu;
  onCommand: (id: StudioCommandId) => void;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  asChild?: boolean;
}) {
  /**
   * OPENING-GESTURE SUPPRESSION (no time window).
   *
   * Radix opens the menu directly under the cursor and activates items on
   * pointerup, so the release of the very right-click that opened the menu
   * would fire whichever item sits there — the menu looked like it "did
   * nothing" while silently invoking Rename/Delete. `suppressOpeningRelease`
   * swallows exactly that one release (and the click it synthesizes) and stands
   * down the instant any new pointerdown happens, so an immediate intentional
   * left click, submenu pointer navigation and keyboard activation all work.
   */
  const dispose = useRef<(() => void) | null>(null);
  useEffect(() => () => dispose.current?.(), []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      dispose.current?.();
      dispose.current = null;
    }
    onOpenChange?.(open);
  };

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger
        asChild={asChild}
        onPointerDown={(e) => {
          if (!opensContextMenu(e)) return;
          dispose.current?.();
          dispose.current = suppressOpeningRelease();
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        data-testid="studio-context-menu"
        collisionPadding={8}
        className="max-h-[80vh] w-56 overflow-y-auto"

      >

        <ContextMenuLabel className="truncate py-1 text-[11px]">
          {menu.title}
          {menu.subtitle ? (
            <span className="block font-mono text-[9px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
              {menu.subtitle}
            </span>
          ) : null}
        </ContextMenuLabel>
        {menu.sections.map((s, index) => (
          <div key={s.id}>
            {index === 0 ? null : <ContextMenuSeparator />}
            {s.label ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger className="text-xs" data-testid={`ctx-sub-${s.id}`}>
                  {s.label}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent collisionPadding={8} className="w-52">
                  {s.items.map((c) => (
                    <Item key={c.id} command={c} onCommand={onCommand} />
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : (
              s.items.map((c) => <Item key={c.id} command={c} onCommand={onCommand} />)
            )}
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
