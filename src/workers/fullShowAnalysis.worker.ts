/// <reference lib="webworker" />

import { analyzeFullShow, FullShowError } from "../lib/show/fullshow";
import type {
  FullShowAnalysisInput,
  FullShowWorkerMessage,
} from "../lib/studio/fullShowAnalysis";

const send = (message: FullShowWorkerMessage) => self.postMessage(message);

self.onmessage = (event: MessageEvent<FullShowAnalysisInput>) => {
  try {
    const { report } = analyzeFullShow(event.data.project, {
      ...event.data.options,
      onProgress: (progress) => send({ type: "progress", progress }),
    });
    send({ type: "result", report });
  } catch (error) {
    send({
      type: "error",
      code: error instanceof FullShowError ? error.code : "UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
