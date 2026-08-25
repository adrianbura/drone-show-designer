/// <reference lib="webworker" />

import {
  evaluateTextFormationTrajectory,
  type TextFormationEvaluationInput,
} from "../lib/studio/textFormationEvaluation";

self.onmessage = (event: MessageEvent<TextFormationEvaluationInput>) => {
  const result = evaluateTextFormationTrajectory(event.data);
  self.postMessage(result);
};

export {};
