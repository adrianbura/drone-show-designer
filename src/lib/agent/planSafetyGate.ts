/**
 * Untrusted AI plans are DATA, never executable editor commands.
 * The editor supplies its actual supported capabilities at runtime.
 */
export type AgentCapability = {
  id: string;
  enabled: boolean;
  requiresSelection: boolean;
  requiresPreview: boolean;
  reversible: boolean;
  arguments: Record<string, "string" | "number" | "boolean">;
};
export type AgentOperation = { tool: string; args: Record<string, unknown> };
export type AgentPlan = { operations: AgentOperation[] };
export type PlanCheck =
  | { ok: true; operations: AgentOperation[]; requiresPreview: boolean }
  | { ok: false; reason: string; operationIndex?: number };

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Fail closed on unknown tools, extra arguments, prototype-pollution keys,
 * malformed model responses, and ambiguous scene context.
 * Does not apply mutations. The caller must use one atomic preview/commit.
 */
export function checkAgentPlan(
  input: unknown,
  capabilities: readonly AgentCapability[],
  selectedSceneId: string | null,
  maxOperations = 8,
): PlanCheck {
  if (!isRecord(input) || Object.keys(input).some((key) => key !== "operations")) {
    return { ok: false, reason: "Invalid plan envelope" };
  }
  const operations = input.operations;
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > maxOperations) {
    return { ok: false, reason: "Invalid operation count" };
  }
  const registry = new Map(capabilities.map((capability) => [capability.id, capability]));
  const checked: AgentOperation[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation: unknown = operations[index];
    if (!isRecord(operation) || Object.keys(operation).some((key) => key !== "tool" && key !== "args")) {
      return { ok: false, reason: "Malformed operation", operationIndex: index };
    }
    if (typeof operation.tool !== "string" || !isRecord(operation.args)) {
      return { ok: false, reason: "Malformed tool or arguments", operationIndex: index };
    }
    const capability = registry.get(operation.tool);
    if (!capability || !capability.enabled) {
      return { ok: false, reason: "Unsupported tool", operationIndex: index };
    }
    if (capability.requiresSelection && !selectedSceneId) {
      return { ok: false, reason: "Select a scene first", operationIndex: index };
    }
    const allowed = Object.keys(capability.arguments);
    const actual = Object.keys(operation.args);
    if (actual.length !== allowed.length || actual.some((key) => !allowed.includes(key) || FORBIDDEN_KEYS.has(key))) {
      return { ok: false, reason: "Unexpected or missing arguments", operationIndex: index };
    }
    for (const [key, expected] of Object.entries(capability.arguments)) {
      const value = operation.args[key];
      if (typeof value !== expected || (expected === "number" && !Number.isFinite(value))) {
        return { ok: false, reason: "Invalid argument type", operationIndex: index };
      }
      if (typeof value === "string" && (value.length > 2048 || /[\\u0000-\\u001f]/.test(value))) {
        return { ok: false, reason: "Invalid string argument", operationIndex: index };
      }
    }
    checked.push({ tool: operation.tool, args: { ...operation.args } });
  }
  return { ok: true, operations: checked, requiresPreview: capabilities.some((c) => c.requiresPreview && checked.some((op) => op.tool === c.id)) };
}
