/**
 * STUDIO CONTEXT MENU (presentation only).
 *
 * Renders a `StudioCommandMenu` produced by the single command authority
 * (`src/lib/studio/commands.ts`) on top of the existing shadcn/Radix context
 * menu primitive. It contains ZERO availability rules and ZERO mutations: the
 * owner passes `onCommand`, which dispatches into the canonical store actions.
 *
 * NO OPENING-GESTURE SUPPRESSION. An event-level trace at 1366, 1024 and 900 px
 * proved native Radix never activates an item from the opening right-click: for
 * a mouse the right-button release completes before `contextmenu` fires, so no
 * item exists yet to receive it. The real cause of "dead" menu actions was the
 * timeline track taking pointer capture on portal-bubbled pointerdowns; that is
 * fixed at the track (see `src/lib/studio/menuSurface.ts`). Redundant gesture
 * logic and timers were therefore deleted rather than maintained.
 */
import type { ReactNode } from "react";

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
  return (
    <ContextMenu {...(onOpenChange ? { onOpenChange } : {})}>
      <ContextMenuTrigger asChild={asChild}>{children}</ContextMenuTrigger>
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
