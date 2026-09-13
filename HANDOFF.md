# Drone Show Designer — Handoff / Stare actuală

> Document de predare pentru un al doilea asistent (ChatGPT) conectat la același repo GitHub
> (`adrianbura/drone-show-designer`, branch `main`). Scop: să știe unde am rămas, ce reguli
> se respectă și ce mai trebuie făcut.

## 1. Ce este aplicația

Studio web pentru proiectarea, validarea și exportul de show-uri cu drone luminoase.
Stack: **TanStack Start v1 + React 19 + Vite 7 + Tailwind v4 + React Three Fiber**.
Fără backend momentan (fără Lovable Cloud / Supabase) — totul rulează client-side,
proiectele se salvează/încarcă ca fișier `.dsp.json`.
Există și un serviciu Python separat, `simulation_bridge/` (FastAPI), pentru simulare
(mock, MDS, PX4-SITL) — nu e obligatoriu pentru editor.

## 2. Harta codului

| Zonă | Locație | Rol |
| --- | --- | --- |
| Domeniu pur (fără React) | `src/lib/show/**` | formații, assignment, trajectory, transition, safety, fullshow, lighting, dynamic, geo, svg, text, scene, preshow |
| Stat + autorități UI | `src/lib/studio/**` | `store.tsx` (canonic), history/undo, autorități pure (`effectCatalog`, `phaseEditor`, `clipPhaseNotice`, `siteGeofence`, `workspaceSections`, …) |
| Export/import | `src/lib/adapters/**`, `src/lib/import/essp/**` | JSON documentat, CSV, ESSP, simulation handoff, preflight |
| UI | `src/components/studio/**` | Timeline, Viewport3D, Inspector + panouri |
| Rute | `src/routes/index.tsx`, `src/routes/__root.tsx`, `src/routes/api/generate-reference.ts` | o singură pagină de studio + un endpoint AI |
| Docs | `ARCHITECTURE.md`, `docs/*.md` | contracte de format, forensics ESSP, design vizual |
| Plan/istoric | `.lovable/plan/*.md` | planuri aprobate (inclusiv propunerile A–D) |

## 3. Ce funcționează acum (implementat și testat)

- **Timeline** cu clipuri, faze TAKEOFF / SHOW / LANDING, tranziții + hold, motion track,
  lighting track, Visual States lane (cue editabile: drag, resize, snapping, clamping).
- **Formații**: grid/circle/sphere/helix/cube/wave/heart/text, import **SVG**, **AI Visual
  Creator** (OpenAI GPT Image 2 prin Lovable AI Gateway) și **AI Formation Creator**
  (provider mock determinist, pregătit pentru LLM).
- **Scene Composer** (inspirat de Skybrush): visual layers, grupuri, alocare de drone,
  rezerve, vizibilitate, redenumire inline, wizard „Create Visual”.
- **Transform**: gizmo Move/Rotate/Scale + inspector numeric, per obiect și per grup,
  cu preview la timpul curent al clipului și o singură intrare de undo.
- **Efecte**: catalog unificat (culoare + mișcare) cu căutare, filtre și categorii; live
  preview cu Cancel/Apply; secțiune proprie „Effect catalog” în Inspector și în meniul
  de click-dreapta pe clip.
- **Phase editor** pentru Formation/Display (interval, header, scurtături non-mutante).
- **Tranziții**: design per clip + aplicare bulk pe tot show-ul, stagger (AUTO,
  SYNCHRONIZED, STAGGERED, BOTTOM_TOP, TOP_BOTTOM), departure waves (`waveCount`,
  offset deterministe, `effectiveStagger`).
- **Safety**: separare minimă (spatial hash), viteză/accelerație/jerk, yaw, tavan, arie,
  landing, autonomie baterie; analiză full-show asincronă în worker, cu progres,
  Cancel, run tokens (`analysisRunAuthority`) și invalidare centrală (`derivedAnalysis`).
- **Geofence GPS fără Google API**: origine, heading, perimetru poligonal, margine,
  tavan, coordonate public → direcție de vizionare; overlay în viewport + `SitePanel`.
- **Show readiness**: șase verificări end-to-end, focus pe issue, export pachet simulator,
  disclaimer explicit că NU autorizează zborul.
- **Export**: JSON documentat (`docs/EXPORT_FORMAT.md`), CSV, **ESSP** (inclusiv recovery
  din sursa importată), pachet ZIP determinist pentru simulator.
- **Lifecycle proiect**: save/autosave, dirty state, adopție, schimbare de proiect atomică,
  unsaved-work guard, undo/redo complet.
- **i18n** EN/RO (`src/i18n/**`).

Verificări: **~1332 teste trecute, 1 skipped**; typecheck, lint și production build curate.

## 4. Reguli obligatorii de lucru (nu le încălca)

- Autoritate unică pentru fază: `clipPhase()`. TAKEOFF/LANDING **nu** sunt clipuri de
  editare vizuală — Visuals/Transform/Colour/Motion sunt blocate acolo, cu mesaj explicit.
- Nu se inventează calcule noi de siguranță și nici tipuri noi de efecte. Panourile noi
  sunt **proiecții pure** peste date canonice.
- Nu se modifică fără cerere explicită: `src/lib/show/**` (planner, validator, safety,
  trajectory, transition, lighting, dynamic), `src/lib/studio/store.tsx`,
  `src/lib/studio/selectionEffects.ts`, schemele de import/export, semantica Undo/Redo.
- Fiecare mutație canonică = **o singură** intrare de history.
- Verificări înainte de raportare: `bunx vitest run --maxWorkers=2` (timeout 600s),
  `bunx tsgo --noEmit`, lint pe fișierele atinse, `bun run build`.
- Nu se face commit/push în afara sincronizării Git a platformei.

## 5. Ce mai trebuie făcut (prioritizat)

1. **SVG Text ca sursă de formație de primă clasă** — import SVG cu litere convertite în
   contururi, grupuri per literă/cuvânt, distribuție uniformă pe lungime de arc, preview +
   validare separare, Apply. Deblochează fonturi reale (Illustrator/Inkscape).
   Bază existentă: `src/lib/show/svg/**`, `src/lib/show/text/**`, `SvgImportPanel.tsx`.
2. **Blocarea exportului la breșă de perimetru GPS** — singurul punct deschis din
   `roadmap.md`: integrează `scanGeofence` în validarea full-show și în
   `exportEligibility` / `exportPreflight`.
3. **Stagger pe Z ca politică globală de siguranță** (propunerea B din plan) — parametru
   global aplicat după generarea geometriei, cu override per formație `forceFlat`.
4. **Efecte de lumină avansate** peste preseturile existente (fără tipuri noi de efect
   dacă nu e cerut explicit).
5. **Bibliotecă de asseturi + templates profesionale**, copy/paste de scene și efecte.
6. **Audio-driven design** (cue-uri legate de beat grid; există deja `audio.ts` cu BPM).
7. **Integrare simulator/hardware reală** prin `simulation_bridge/` (PX4-SITL, MDS) și
   formate suplimentare de producători.
8. **Cloud + teamwork** (persistență, jobs, colaborare) — necesită activarea unui backend.

## 6. Limitări cunoscute, de comunicat onest

- Aplicația **nu** autorizează zborul; validările sunt de design, nu certificare.
- AI Formation Creator este determinist/mock, nu un LLM real.
- Faza Formation nu are încă culoare și mișcare proprii.
- Proiectele vechi rămân plane (fără stagger pe Z) — compatibilitate păstrată.
- Testul `exportRecoveryIsolation` este skipped: verifica indentarea exactă din `store.tsx`.
