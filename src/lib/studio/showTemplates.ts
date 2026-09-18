/**
 * SHOW TEMPLATES — deterministic starting structures for a new project.
 *
 * Templates only compose existing project formations into the canonical
 * timeline. They never own trajectory, assignment, safety or phase geometry:
 * TAKEOFF/LANDING are built by the phase-clip authority and every SHOW moment
 * is inserted through the ordinary timeline insertion authority.
 */
import {
  defaultLandingParams,
  defaultTakeoffParams,
  withLandingClip,
  withTakeoffClip,
} from "../show/preshow/phaseClips";
import type { LightEffect, RGB, ShowProject, TimelineClip } from "../show/types";
import { insertClipBeforeLanding } from "./clipInsertion";

export type ShowTemplateId = "BLANK" | "SHORT_OPENER" | "CLASSIC_ARC";

export interface ShowTemplateDescriptor {
  readonly id: ShowTemplateId;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly showMomentCount: number;
}

export const SHOW_TEMPLATES: readonly ShowTemplateDescriptor[] = [
  {
    id: "BLANK",
    nameKey: "setup.template.blank",
    descriptionKey: "setup.template.blankDescription",
    showMomentCount: 0,
  },
  {
    id: "SHORT_OPENER",
    nameKey: "setup.template.shortOpener",
    descriptionKey: "setup.template.shortOpenerDescription",
    showMomentCount: 2,
  },
  {
    id: "CLASSIC_ARC",
    nameKey: "setup.template.classicArc",
    descriptionKey: "setup.template.classicArcDescription",
    showMomentCount: 3,
  },
];

interface TemplateMoment {
  readonly formationId: string;
  readonly transition: number;
  readonly hold: number;
  readonly color: RGB;
  readonly effect: LightEffect;
}

const MOMENTS: Record<Exclude<ShowTemplateId, "BLANK">, readonly TemplateMoment[]> = {
  SHORT_OPENER: [
    {
      formationId: "f-sphere",
      transition: 16,
      hold: 8,
      color: [90, 210, 255],
      effect: "pulse",
    },
    {
      formationId: "f-heart",
      transition: 18,
      hold: 10,
      color: [255, 90, 140],
      effect: "twinkle",
    },
  ],
  CLASSIC_ARC: [
    {
      formationId: "f-sphere",
      transition: 18,
      hold: 8,
      color: [90, 210, 255],
      effect: "pulse",
    },
    {
      formationId: "f-helix",
      transition: 20,
      hold: 8,
      color: [255, 190, 80],
      effect: "rainbow",
    },
    {
      formationId: "f-heart",
      transition: 20,
      hold: 12,
      color: [255, 90, 140],
      effect: "twinkle",
    },
  ],
};

export function findShowTemplate(id: ShowTemplateId): ShowTemplateDescriptor {
  return SHOW_TEMPLATES.find((template) => template.id === id) ?? SHOW_TEMPLATES[0]!;
}

/** Applies a template to the clean project produced by Project Setup. */
export function applyShowTemplate(project: ShowProject, id: ShowTemplateId): ShowProject {
  if (id === "BLANK") return project;
  const formationIds = new Set(project.formations.map((formation) => formation.id));
  const moments = MOMENTS[id];
  if (
    !formationIds.has("f-launch") ||
    !formationIds.has("f-approach") ||
    moments.some((moment) => !formationIds.has(moment.formationId))
  ) {
    return project;
  }

  let timeline = withTakeoffClip(
    [],
    { id: `template-${id.toLowerCase()}-takeoff`, formationId: "f-launch" },
    defaultTakeoffParams(project),
  );
  moments.forEach((moment, index) => {
    const clip: TimelineClip = {
      id: `template-${id.toLowerCase()}-${index + 1}`,
      formationId: moment.formationId,
      start: 0,
      transition: moment.transition,
      hold: moment.hold,
      easing: "minJerk",
      color: moment.color,
      effect: moment.effect,
      phase: "SHOW",
    };
    timeline = insertClipBeforeLanding(timeline, clip);
  });
  timeline = withLandingClip(
    timeline,
    { id: `template-${id.toLowerCase()}-landing`, formationId: "f-approach" },
    defaultLandingParams(project),
  );
  return { ...project, timeline };
}
