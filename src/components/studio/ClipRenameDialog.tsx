/**
 * RENAME DIALOG — the single naming surface for the Rename… command.
 *
 * Cancel changes nothing, Save commits exactly ONE authored revision through the
 * canonical store action (formation rename, or marker label). An empty name is
 * refused rather than silently erasing a name.
 */
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStudio } from "@/lib/studio/store";
import type { RenameRequest } from "@/lib/studio/useTimelineCommands";

export default function ClipRenameDialog({
  request,
  onClose,
}: {
  request: RenameRequest | null;
  onClose: () => void;
}) {
  const { renameFormation, patchMarker, project } = useStudio();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (request) setValue(request.current);
  }, [request]);

  const commit = () => {
    const name = value.trim();
    if (!request || !name) return;
    if (request.kind === "MARKER") {
      patchMarker(request.id, { label: name });
    } else {
      const clip = project.timeline.find((c) => c.id === request.id);
      if (clip) renameFormation(clip.formationId, name);
    }
    onClose();
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-sm" data-testid="rename-dialog">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {request?.kind === "MARKER" ? "Rename marker" : "Rename formation"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {request?.kind === "MARKER"
              ? "Renames this timeline marker."
              : "Renames the formation this clip shows. Geometry is not regenerated."}
          </DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          className="studio-input"
          aria-label="New name"
          data-testid="rename-input"
        />
        <DialogFooter>
          <button type="button" onClick={onClose} className="chip-btn">
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!value.trim()}
            className="chip-btn chip-btn-active"
            data-testid="rename-save"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
