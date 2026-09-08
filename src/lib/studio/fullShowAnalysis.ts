import {
  analyzeFullShow,
  type AnalyzeFullShowOptions,
  type FullShowProgress,
  type FullShowValidationReport,
} from "../show/fullshow";
import type { ShowProject } from "../show/types";

export type FullShowWorkerOptions = Omit<AnalyzeFullShowOptions, "onProgress" | "isCancelled">;

export interface FullShowAnalysisInput {
  readonly project: ShowProject;
  readonly options: FullShowWorkerOptions;
}

export type FullShowWorkerMessage =
  | { readonly type: "progress"; readonly progress: FullShowProgress }
  | { readonly type: "result"; readonly report: FullShowValidationReport }
  | { readonly type: "error"; readonly code: string; readonly message: string };

export class FullShowAnalysisTaskError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FullShowAnalysisTaskError";
  }
}

export interface FullShowAnalysisTask {
  readonly promise: Promise<FullShowValidationReport>;
  readonly cancel: () => void;
}

/** Runs the canonical validator off the rendering thread when workers exist. */
export function startFullShowAnalysis(
  input: FullShowAnalysisInput,
  onProgress: (progress: FullShowProgress) => void,
): FullShowAnalysisTask {
  if (typeof Worker === "undefined") {
    let cancelled = false;
    return {
      promise: Promise.resolve().then(
        () =>
          analyzeFullShow(input.project, {
            ...input.options,
            onProgress,
            isCancelled: () => cancelled,
          }).report,
      ),
      cancel: () => {
        cancelled = true;
      },
    };
  }

  const worker = new Worker(new URL("../../workers/fullShowAnalysis.worker.ts", import.meta.url), {
    type: "module",
  });
  let settled = false;
  let rejectTask: (reason: Error) => void = () => undefined;
  const promise = new Promise<FullShowValidationReport>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<FullShowWorkerMessage>) => {
      if (event.data.type === "progress") {
        onProgress(event.data.progress);
        return;
      }
      settled = true;
      worker.terminate();
      if (event.data.type === "result") resolve(event.data.report);
      else reject(new FullShowAnalysisTaskError(event.data.code, event.data.message));
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      reject(new FullShowAnalysisTaskError("WORKER_FAILED", event.message));
    };
    worker.postMessage(input);
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectTask(new FullShowAnalysisTaskError("ANALYSIS_CANCELLED", "Analysis cancelled."));
    },
  };
}
