# Right-click menu that closes instantly — diagnosis and fix

## What actually happens

The menu is not broken by the previous command. Right-clicking a clip near the
**lower part** of the clip fails the very first time, on a completely clean show,
with no Copy and no clipboard involved.

Reason: when you press the right button, the menu opens immediately under the
cursor. If the menu is positioned so that one of its rows sits exactly where the
cursor is (which happens whenever the menu has to open upwards — bottom of the
timeline dock, bottom edge of a clip), then **releasing the right button counts as
clicking that row**. The row runs, the menu closes, and it looks like "the menu no
longer opens".

Copy only made it more visible: after Copy the menu has one more enabled row, so
the row layout shifts and a row lands under the cursor where previously only
padding did.

## Evidence (preview at 1600x1800, commit 234e8bb)

Show built in the preview: launch grid, take-off, 2 show segments, landing.

| Trial | Anchor on the clip | Button held | Result |
| --- | --- | --- | --- |
| clean state | top-left (20, 8) | released at once | menu opens and stays |
| clean state | lower-right | released at once | menu closes at once; release landed on the row `Rename clip…` |
| clean state | lower-right | held 400 ms | menu opens and stays |
| after Copy | top-left (20, 8) | released at once | menu closes at once; release landed on the row `Paste` |
| after Copy | other clip, top-left | released at once | menu opens and stays |

Event trace of a failing case (document level): `pointerdown(btn 2)` →
`mousedown(btn 2)` → `contextmenu` (defaultPrevented true, so the menu *did* open)
→ `pointerup(btn 2)` **with the menu row as target** → menu gone.

State trace: nothing is stuck. After the failure `body.style.pointerEvents` is
back to empty, `aria-hidden` is removed from `main`, zero menu nodes and zero
popper wrappers remain. Opening it again with a synthetic event works simply
because a synthetic event has no button release after it.

## Causes explicitly ruled out

- **Radix dismissable-layer / modal cleanup** — ruled out: body pointer-events and
  aria-hidden are fully restored after every failure.
- **Nested triggers (track menu wrapping the clip menu)** — ruled out: the clip
  `onContextMenu` stops propagation, and the same clip succeeds or fails purely
  depending on where you click.
- **Timeline pointer capture / portal bubbling** — ruled out: the existing guard
  (`isInsideMenuSurface`) works; the track never captures menu pointer events.
- **stopPropagation / handler ordering on the clip** — ruled out: `contextmenu`
  always reaches the trigger and is always defaultPrevented (menu opens).
- **Stale controlled/uncontrolled open state** — ruled out: the menus are
  uncontrolled and no leftover open state exists between attempts.
- **Real cause**: the menu row under the cursor is activated by the release of the
  same right-click that opened the menu, because menu rows react to any pointer
  release, not only to the primary button.

## The fix (smallest, presentation only)

One guard in `src/components/studio/StudioContextMenu.tsx`: on the menu content and
the submenu content, ignore pointer releases and clicks that do not come from the
primary (left) button, in the capture phase, before the row sees them.

What this preserves, by construction:

- cursor anchoring is untouched (no change to positioning props)
- submenus keep working (same guard on submenu content)
- keyboard behaviour untouched (Enter/Space/arrows are not pointer events)
- the empty-timeline menu benefits from the same guard (same component)
- one command = one undo entry is unchanged (no store, no command changes)

No change to the store, the command authority, timeline gestures, safety,
trajectory, import or export.

## Regression test

- **JSDOM can model the mechanism**, not the geometry. Add a case to
  `src/components/studio/__tests__/studioContextMenu.dom.test.tsx`: open the menu,
  dispatch `pointerup` with `button: 2` on a row, assert no command ran and the
  menu is still open; then assert a normal left click on the same row still runs
  the command exactly once.
- **JSDOM cannot** reproduce "a row happens to sit under the cursor", because it has
  no layout and no collision flipping. That part belongs to a Playwright check:
  right-click the lower edge of a show clip with a real mouse and assert the menu
  is still open and no clip was added.

## Files that should change

- `src/components/studio/StudioContextMenu.tsx` — the guard (only production change)
- `src/components/studio/__tests__/studioContextMenu.dom.test.tsx` — regression case
- `HANDOFF.md`, `roadmap.md` — record the cause, the fix and the verification

Not touched: `src/components/ui/context-menu.tsx` (StudioContextMenu is its only
consumer, so the guard does not need to live in the shared primitive),
`src/components/studio/Timeline.tsx`, `src/lib/studio/**`.
