# AI in Drone Show Studio

## Product decision (authoritative)

**AI creates visual formation assets. The user directs the show.**

- AI proposes artistic intent; deterministic Studio code produces geometry.
- AI never generates trajectories, never chooses physical drone ids, never
  performs collision avoidance and never emits hardware commands.
- AI does **not** synchronise formations to music: no beat detection, no bar
  sync, no chorus/drop detection, no section selection, no automatic timeline
  placement, no automatic scene sequencing.
- The user places assets on the timeline, sets transition and hold, aligns them
  with the music and edits lighting effects.

## Pipeline

```text
Prompt / Image / Built-in design
  -> provider (mock today, real provider later, always validated)
  -> VisualFormationDesign          docs/VISUAL_FORMATION_DESIGN.md
  -> Drone Art Compiler             docs/DRONE_ART_COMPILER.md
  -> Formation / DynamicFormation
  -> Formation Library              docs/FORMATION_LIBRARY.md
  -> USER-controlled show timeline
  -> fleet participation -> assignment -> trajectory -> lighting -> validation
```

## Layers

- `src/lib/ai/prompt.ts` — bilingual (EN/RO) rule-based prompt parsing.
- `src/lib/ai/mockProvider.ts` — deterministic provider, kept on purpose. No real
  LLM, no Lovable AI Gateway, no external calls in this build.
- `src/lib/ai/geometry.ts`, `builder.ts` — procedural concept geometry for simple
  shapes (circle, ring, heart, star, spiral, wave). These stay: AI does not need
  to reinvent a circle. Complex artwork ("realistic pigeon") routes to the visual
  compiler instead.
- `src/lib/ai/types.ts` — `AIChoreographyProposalV1`, unchanged.
- `src/lib/ai/visualIntent.ts` — additive `AIFormationProposalV2` visual-asset
  intent: `formationDroneCount`, `designMode`, `designRef`, `style`, `symmetry`,
  `animationIntent`, `baseColorIntent`, optional `lightingEffects[]` suggestions.
  `migrateProposalV1ToV2` migrates; `validateFormationProposalV2` must pass before
  any provider output becomes project content. Timing (transition / hold) is
  deliberately dropped — it is a user decision.

## Panel

The AI panel is presented as **AI formation creator / Creator AI de formații**.
It renders a DRAFT and mutates nothing until a human applies it, and it no longer
offers "apply and add to timeline". Asset creation happens in the **Visual
formation lab**, whose primary action is *Save to formation library*.
