/**
 * STRUCTURE EDITOR — editor-only state.
 *
 * Holds the immutable extracted design (8B1 output, NEVER mutated), the edited
 * draft, a local snapshot undo/redo history and transient selection / drawing
 * state. Selection, hover, drawing and history are editor-only and are never
 * serialized into a project or a library asset.
 *
 * The domain is intentionally separate from the timeline and dynamic-formation
 * histories in the studio store, so this history is local.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import type { DesignPoint, VisualFormationDesign } from "../types";
import {
  addPolyline,
  deletePrimitive,
  enabledPrimitiveCount,
  isDrawablePath,
  setPrimitiveEnabled,
  setPrimitiveImportance,
} from "./commands";
import type { StructureImportance } from "./importance";

export type StructureTool = "SELECT" | "DRAW";

const HISTORY_LIMIT = 50;

export interface StructureEditorState {
  readonly draft: VisualFormationDesign;
  readonly selectedId: string | null;
  readonly tool: StructureTool;
  readonly drawing: readonly DesignPoint[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly edited: boolean;
  readonly editOps: number;
  select: (id: string | null) => void;
  setTool: (tool: StructureTool) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  setImportance: (id: string, level: StructureImportance) => void;
  remove: (id: string) => void;
  addDrawPoint: (point: DesignPoint) => void;
  commitDrawing: () => boolean;
  cancelDrawing: () => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
}

export function useStructureEditor(
  extracted: VisualFormationDesign | null,
): StructureEditorState | null {
  const [seed, setSeed] = useState<VisualFormationDesign | null>(extracted);
  const [draft, setDraft] = useState<VisualFormationDesign | null>(extracted);
  const [past, setPast] = useState<readonly VisualFormationDesign[]>([]);
  const [future, setFuture] = useState<readonly VisualFormationDesign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setToolState] = useState<StructureTool>("SELECT");
  const [drawing, setDrawing] = useState<readonly DesignPoint[]>([]);
  const opsRef = useRef(0);
  const [editOps, setEditOps] = useState(0);

  // Re-seed when the analysis produces a new extraction: primitive ids belong to
  // that extraction, so silently remapping previous edits would be dishonest.
  if (seed !== extracted) {
    setSeed(extracted);
    setDraft(extracted);
    setPast([]);
    setFuture([]);
    setSelectedId(null);
    setDrawing([]);
    setToolState("SELECT");
    opsRef.current = 0;
    setEditOps(0);
  }

  /**
   * One user gesture = one undo entry. The mutation is applied to the CURRENT
   * draft inside the updater, so rapid gestures can never drop an edit.
   */
  const apply = useCallback(
    (mutate: (design: VisualFormationDesign) => VisualFormationDesign) => {
      setDraft((current) => {
        if (!current) return current;
        const next = mutate(current);
        // A design the compiler cannot use is never committed.
        if (next === current || enabledPrimitiveCount(next) === 0) return current;
        setPast((p) => [...p, current].slice(-HISTORY_LIMIT));
        setFuture([]);
        opsRef.current += 1;
        setEditOps(opsRef.current);
        return next;
      });
    },
    [],
  );

  const setEnabled = useCallback(
    (id: string, enabled: boolean) => {
      apply((design) => setPrimitiveEnabled(design, id, enabled));
    },
    [apply],
  );

  const setImportance = useCallback(
    (id: string, level: StructureImportance) => {
      apply((design) => setPrimitiveImportance(design, id, level));
    },
    [apply],
  );

  const remove = useCallback(
    (id: string) => {
      apply((design) => deletePrimitive(design, id));
      setSelectedId((current) => (current === id ? null : current));
    },
    [apply],
  );

  const addDrawPoint = useCallback((point: DesignPoint) => {
    setDrawing((current) => [...current, point]);
  }, []);

  const commitDrawing = useCallback((): boolean => {
    if (!isDrawablePath(drawing)) {
      setDrawing([]);
      return false;
    }
    apply((design) => addPolyline(design, drawing));
    setDrawing([]);
    setToolState("SELECT");
    return true;
  }, [apply, drawing]);

  const cancelDrawing = useCallback(() => {
    setDrawing([]);
    setToolState("SELECT");
  }, []);

  const setTool = useCallback((next: StructureTool) => {
    setDrawing([]);
    setToolState(next);
  }, []);

  const reset = useCallback(() => {
    if (!seed) return;
    setDrawing([]);
    setSelectedId(null);
    apply(() => seed);
  }, [apply, seed]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1]!;
      setDraft((current) => {
        if (current) setFuture((f) => [current, ...f]);
        return previous;
      });
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0]!;
      setDraft((current) => {
        if (current) setPast((p) => [...p, current].slice(-HISTORY_LIMIT));
        return next;
      });
      return f.slice(1);
    });
  }, []);

  return useMemo(() => {
    if (!draft) return null;
    return {
      draft,
      selectedId,
      tool,
      drawing,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      edited: draft !== seed,
      editOps,
      select: setSelectedId,
      setTool,
      setEnabled,
      setImportance,
      remove,
      addDrawPoint,
      commitDrawing,
      cancelDrawing,
      reset,
      undo,
      redo,
    };
  }, [
    addDrawPoint,
    cancelDrawing,
    commitDrawing,
    draft,
    drawing,
    editOps,
    future.length,
    past.length,
    redo,
    remove,
    reset,
    seed,
    selectedId,
    setEnabled,
    setImportance,
    setTool,
    tool,
    undo,
  ]);
}
