/**
 * AI AGENT — capability registry (single source of truth).
 *
 * Every editor action the agent can perform is declared here with its safety
 * contract. The local parser, the model instructions and the panel UI all read
 * from this registry, so the agent can never claim a capability it does not
 * have: unsupported kinds are listed explicitly as a roadmap, never executed,
 * and the panel says so honestly when the user asks for one.
 *
 * Coverage rule: an action is "supported" only when it is wired end-to-end
 * (parser + model schema + deterministic operation + validator + undo).
 */
export type AgentCapabilityKind =
  | "ROTATE_SCENE"
  | "RECOLOR_SCENE"
  | "SET_DURATION"
  | "SELECT_SCENE"
  // --- Roadmap: declared, refused, never executed. ---
  | "SCALE_SCENE"
  | "MOVE_SCENE"
  | "EDIT_TRANSITION"
  | "EDIT_LIGHTING"
  | "INSERT_LIBRARY_SCENE"
  | "CHANGE_DRONE_COUNT";

export interface AgentCapability {
  kind: AgentCapabilityKind;
  status: "supported" | "unsupported";
  name: { ro: string; en: string };
  description: { ro: string; en: string };
  safety: {
    /** Produces a preview card before anything is committed. */
    preview: boolean;
    /** Passes the pre-commit validator. */
    validator: boolean;
    /** Committed as a single undoable revision. */
    undo: boolean;
  };
  examples: { ro: string; en: string }[];
}

export const AGENT_CAPABILITIES: readonly AgentCapability[] = [
  {
    kind: "ROTATE_SCENE",
    status: "supported",
    name: { ro: "Rotire / înclinare scenă", en: "Rotate / tilt scene" },
    description: {
      ro: "Rotește rigid întreaga scenă (inclusiv traiectoriile animate) în jurul centrului ei.",
      en: "Rigidly rotates the whole scene (including animated trajectories) about its centroid.",
    },
    safety: { preview: true, validator: true, undo: true },
    examples: [
      { ro: "înclină scena 20 de grade spre stânga", en: "tilt the scene 20 degrees left" },
      { ro: "rotește scena 45 de grade", en: "rotate the scene 45 degrees" },
    ],
  },
  {
    kind: "RECOLOR_SCENE",
    status: "supported",
    name: { ro: "Recolorare scenă", en: "Recolor scene" },
    description: {
      ro: "Schimbă culoarea de bază; animația de luminozitate înregistrată se păstrează.",
      en: "Changes the base color; the recorded luminance animation is preserved.",
    },
    safety: { preview: true, validator: true, undo: true },
    examples: [
      { ro: "schimbă culoarea în auriu", en: "recolor it gold" },
      { ro: "colorează scena #ff2864", en: "recolor the scene #ff2864" },
    ],
  },
  {
    kind: "SET_DURATION",
    status: "supported",
    name: { ro: "Durata scenei", en: "Scene duration" },
    description: {
      ro: "Schimbă cât stă scena pe cer; scenele următoare se decalează automat, fără suprapuneri.",
      en: "Changes how long the scene holds; following clips shift automatically, never overlap.",
    },
    safety: { preview: true, validator: true, undo: true },
    examples: [
      { ro: "ține scena 12 secunde", en: "hold the scene for 12 seconds" },
      { ro: "prelungește cu 5 secunde", en: "extend it by 5 seconds" },
    ],
  },
  {
    kind: "SELECT_SCENE",
    status: "supported",
    name: { ro: "Selectare scenă", en: "Select scene" },
    description: {
      ro: "Selectează o scenă după numărul din cronologie sau după nume.",
      en: "Selects a scene by its timeline number or by name.",
    },
    safety: { preview: false, validator: false, undo: false },
    examples: [
      { ro: "selectează scena 5", en: "select scene 5" },
      { ro: "selectează inima", en: "select the heart" },
    ],
  },
  // --- Roadmap below: known, refused with an honest message, never faked. ---
  {
    kind: "SCALE_SCENE",
    status: "unsupported",
    name: { ro: "Scalare scenă", en: "Scale scene" },
    description: {
      ro: "Mărirea/micșorarea scenei — necesită revalidarea separării minime între drone.",
      en: "Growing/shrinking a scene — needs minimum-separation revalidation.",
    },
    safety: { preview: false, validator: false, undo: false },
    examples: [],
  },
  {
    kind: "MOVE_SCENE",
    status: "unsupported",
    name: { ro: "Mutare scenă", en: "Move scene" },
    description: {
      ro: "Mutarea scenei în alt loc din spațiul de zbor.",
      en: "Relocating a scene inside the flight area.",
    },
    safety: { preview: false, validator: false, undo: false },
    examples: [],
  },
  {
    kind: "EDIT_TRANSITION",
    status: "unsupported",
    name: { ro: "Editare tranziție", en: "Edit transition" },
    description: {
      ro: "Schimbarea duratei sau curbei tranziției dintre scene.",
      en: "Changing the duration or easing of the transition between scenes.",
    },
    safety: { preview: false, validator: false, undo: false },
    examples: [],
  },
  {
    kind: "EDIT_LIGHTING",
    status: "unsupported",
    name: { ro: "Editare efecte de lumini", en: "Edit lighting effects" },
    description: {
      ro: "Adăugarea sau modificarea efectelor de lumini ale scenei.",
      en: "Adding or modifying the scene's lighting effects.",
    },
    safety: { preview: false, validator: false, undo: false },
    examples: [],
  },
  {
    kind: "INSERT_LIBRARY_SCENE",
    status: "unsupported",
    name: { ro: "Inserare scenă din bibliotecă", en: "Insert library scene" },
    description: {
      ro: "Căutarea și inserarea unei scene salvate în biblioteca personală.",
      en: "Searching and inserting a scene saved in the personal library.",
    },
    safety: { preview: false, validator: false, undo: false },
    examples: [],
  },
  {
    kind: "CHANGE_DRONE_COUNT",
    status: "unsupported",
    name: { ro: "Schimbare număr de drone", en: "Change drone count" },
    description: {
      ro: "Adaptarea unei scene la alt număr de drone — validare în așteptare, nu inventează traiectorii.",
      en: "Adapting a scene to a different drone count — validation pending, never invents trajectories.",
    },
    safety: { preview: false, validator: false, undo: false },
    examples: [],
  },
];

export const SUPPORTED_CAPABILITIES = AGENT_CAPABILITIES.filter((c) => c.status === "supported");
export const UNSUPPORTED_CAPABILITIES = AGENT_CAPABILITIES.filter(
  (c) => c.status === "unsupported",
);

/** Short honest summary for the panel welcome / not-understood messages. */
export function capabilitySummary(ro: boolean): string {
  const names = SUPPORTED_CAPABILITIES.map((c) => (ro ? c.name.ro : c.name.en).toLowerCase());
  return ro
    ? `Momentan știu: ${names.join(", ")}. Restul funcțiilor sunt pe parcurs — nu pretind că le pot face.`
    : `I currently know: ${names.join(", ")}. The remaining functions are on the roadmap — I will not pretend to do them.`;
}

/** Compact capability list injected into the model instructions. */
export function capabilityInstructions(): string {
  const lines = SUPPORTED_CAPABILITIES.map((c) => {
    switch (c.kind) {
      case "ROTATE_SCENE":
        return "- ROTATE_SCENE: axis X (lean forward/back), Y (turn left/right), Z (tilt sideways); degrees signed. Tilt left = negative Z, tilt right = positive Z; turn left = positive Y, turn right = negative Y; lean forward = positive X, backward = negative X.";
      case "RECOLOR_SCENE":
        return "- RECOLOR_SCENE: color as sRGB 0-255 triple (gold = [255,200,40]).";
      case "SET_DURATION":
        return "- SET_DURATION: holdSeconds for an absolute hold time, or deltaSeconds to extend/shorten relative to the current hold. Exactly one of the two.";
      case "SELECT_SCENE":
        return "- SELECT_SCENE: sceneIndex (1-based position in the timeline) or sceneName (name fragment). Exactly one of the two.";
      default:
        return "";
    }
  }).filter(Boolean);
  return `Supported operations (use ONLY these kinds; never invent others):\n${lines.join("\n")}`;
}
