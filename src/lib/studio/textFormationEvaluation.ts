import type { AnalyzeFullShowOptions } from "../show/fullshow";
import {
  evaluateGeometryTrajectoryConsequence,
  type GeometryTrajectoryConsequenceReport,
} from "../show/diagnostics";
import {
  optimizeCandidateGeometryTransitions,
  type CandidateGeometryTransitionOptimizations,
} from "../show/transition";
import type { ShowProject } from "../show/types";

export interface TextFormationEvaluationInput {
  readonly beforeProject: ShowProject;
  readonly candidateProject: ShowProject;
  readonly editedClipId: string;
  readonly options: AnalyzeFullShowOptions;
}

export interface TextFormationEvaluationResult {
  readonly optimizations: CandidateGeometryTransitionOptimizations;
  readonly trajectory: GeometryTrajectoryConsequenceReport;
}

export interface TextFormationEvaluationTask {
  readonly promise: Promise<TextFormationEvaluationResult>;
  readonly cancel: () => void;
}

/** Shared canonical calculation used by the worker and the test/SSR fallback. */
export function evaluateTextFormationTrajectory(
  input: TextFormationEvaluationInput,
): TextFormationEvaluationResult {
  const optimizations = optimizeCandidateGeometryTransitions({
    project: input.candidateProject,
    editedClipId: input.editedClipId,
    assignmentStrategy: input.options.assignmentStrategy ?? "nearestNeighbor",
    ...(input.options.sampleRate !== undefined ? { sampleRate: input.options.sampleRate } : {}),
    ...(input.options.transitionOverrides
      ? { transitionOverrides: input.options.transitionOverrides }
      : {}),
    ...(input.options.reference ? { reference: input.options.reference } : {}),
  });
  const trajectory = evaluateGeometryTrajectoryConsequence(
    input.beforeProject,
    input.candidateProject,
    {
      ...input.options,
      candidateTransitionOverrides: optimizations.overrides,
    },
  );
  return { optimizations, trajectory };
}

/** Runs heavy 150+ drone analysis away from the browser's rendering thread. */
export function startTextFormationEvaluation(
  input: TextFormationEvaluationInput,
): TextFormationEvaluationTask {
  if (typeof Worker === "undefined") {
    return {
      promise: Promise.resolve().then(() => evaluateTextFormationTrajectory(input)),
      cancel: () => undefined,
    };
  }

  const worker = new Worker(
    new URL("../../workers/textFormationEvaluation.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  let settled = false;
  let rejectTask: (reason: Error) => void = () => undefined;
  const promise = new Promise<TextFormationEvaluationResult>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<TextFormationEvaluationResult>) => {
      settled = true;
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      reject(new Error(event.message || "Text transition evaluation worker failed."));
    };
    worker.postMessage(input);
  });
  return {
    promise,
    cancel: () => {
      if (!settled) {
        settled = true;
        worker.terminate();
        rejectTask(new Error("Text transition evaluation cancelled."));
      }
    },
  };
}
