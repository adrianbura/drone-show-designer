# Roadmap

## North Star

Construim o aplicație profesională și ușor de folosit. Fiecare element de roadmap trebuie să
îmbunătățească cel puțin una dintre aceste dimensiuni fără să o degradeze pe cealaltă:

- încredere: rezultate coerente, deterministe, explicabile și verificate;
- claritate: operatorul știe ce are deschis, ce poate face acum și care este următorul pas;
- eficiență: operațiile frecvente cer puțini pași și oferă feedback imediat;
- performanță: experiență fluidă la scara reală de 150–500 de drone;
- interoperabilitate: exporturile și integrările sunt declarate disponibile numai după validare;
- recuperare: greșelile, stările invalide și munca nesalvată au căi clare de remediere.

## Mod de lucru

- ChatGPT coordonează proiectul ca Project Manager tehnic și menține sincronizate acest roadmap
  și `HANDOFF.md` după fiecare schimbare relevantă.
- Comanda utilizatorului **„continuă”** pornește următorul element executabil din secțiunea
  „Prioritate curentă”, cu implementare, teste și actualizarea documentației de stare.
- Lovable este folosit printr-un prompt delimitat atunci când poate accelera o sarcină vizuală
  sau independentă; rezultatul său este revizuit înainte ca elementul să fie bifat.
- Repository-ul GitHub este memoria canonică între conversații. După fiecare etapă materială,
  `HANDOFF.md` păstrează deciziile, verificările, blocajele și următorul pas exact, iar acest
  roadmap păstrează ordinea și starea priorităților.
- O conversație nouă începe prin citirea `AGENTS.md`, `HANDOFF.md` și `roadmap.md`, apoi prin
  verificarea stării Git și a codului; nu reconstruiește planul din memorie sau presupuneri.

## Prioritate curentă

1. [x] Viewport invalidate-on-demand implementat: editor tehnic `demand`, Presentation `always`.
2. [x] Re-măsurare browser 150/500 și verificare seek/playback/controls/selecție/Presentation.
3. [x] Copy/paste intern pentru clipuri SHOW și obiectele scenei (ID-uri noi, un singur Undo).
4. [x] Verificare UX/browser copy/paste; cauza meniului aparent blocat a fost izolată la
       eliberarea butonului dreapta peste un rând repoziționat sub cursor.
5. [x] Șabloane de show: Blank, Short opener și Classic arc în New Show.
6. [x] Verificare UX/browser pentru șabloane.
7. [x] Gard UI pentru eliberarea butonului dreapta în meniul contextual; verificat în browser.
8. [ ] Efecte de lumină avansate.
   - [ ] Editor multi-stop pentru gradientele `COLOR_SWEEP` în inspectorul unificat.
   - [ ] Ancoră temporală și mod de blend în inspectorul unificat.
9. [ ] Imagine → figură: contur/umplere și diagnostic de separare.
   - [x] Import local, Contur/Structural/Umplut și compilare deterministă exact-N există.
   - [x] Afișarea distanței minime și a avertismentelor compilatorului în panoul imaginii.
   - [x] Verificare browser pentru contur/umplere, diagnostic și salvare în bibliotecă.
   - [x] Rezumat de stare (în regulă / atenție), etichete de severitate și ghidaj corectiv
         localizat în panoul imaginii, verificate în browser EN/RO.
   - Rămâne deschis doar pentru un test lent (`sceneComposerPanel.dom.test.tsx`) care depășește
     limita de 5 s când rulează toată suita; trece izolat în 4,5 s. Nu ține de imagini.
10. [ ] Cost de redare la 500 de drone (pauza este rezolvată; redarea rămâne grea).
    - Re-măsurare 18 sep 2026 NECONCLUDENTĂ: commitul cerut `b91f3df` nu există în acest sandbox
      (`git fetch` nu are credențiale), deci măsurarea s-a făcut pe `4e8f8b7`, fără calea de
      eșantionare dublă eliminată. Vezi tabelul din secțiunea de mai jos.
11. [ ] Mentenanță: împărțire `store.tsx`, lint global, CI și Playwright.
12. [ ] Curățenie repository: ignorare și eliminare controlată `__pycache__`/`.pyc` urmărite.

## Capabilități livrate

- [x] Real GPS site: origin, heading, perimeter, margin, ceiling (canonical geo module + migration)
- [x] Site authoring panel + viewport geofence overlay
- [x] Audience coordinates on the site, with derived viewing direction and facing yaw
- [x] Block export on GPS perimeter breach via full-show validation (regression-tested)
- [x] Restrict Visuals, Transform, Colour, and Motion authoring to SHOW clips
- [x] Real-typeface text: glyph pack registry + Archivo wide outline pack + typeface picker
- [x] Shape and figure library (10 parametric figures + searchable, categorised picker)
- [x] Mermaid figure with an animatable tail (SWAY_Z part motion -> tail-wag motion group)
- [x] PDF validation report (downloadable document projected from the existing full-show analysis)
- [x] Imported ESSP presentation reconciles fleet, duration and timeline authority
- [x] Single responsive mount for Inspector/LeftPanel surfaces
- [x] Cinematic Presentation viewport with audience camera and explicit estimated fallback
- [x] Browser frame-time probe at 150 and 500 drones (software-GL sandbox numbers recorded below)
- [x] Internal Copy/Paste for SHOW clips and selected scene objects (single-revision Paste)
- [x] New Show templates: Blank canvas, Short opener and Classic arc
- [ ] ~~Automatic beat detection~~ — dropped by the owner: show moments are authored manually, the manual BPM grid stays
- [ ] ~~.skyc export~~ — dropped: the target hardware loads ESSP, which the app already reads and writes byte-identically

## Browser frame-time probe (18 Sep 2026, headless software GL — not GPU-representative)

Method: Playwright headless Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader`,
1280×1800 viewport, launch grid + take-off + show segment + landing, fleet size set in the
Fleet size field, 5 s rAF sample (first 5 frames dropped), paused and playing.

| Fleet | Paused before        | Paused after               | Playing before       | Playing after          |
| ----- | -------------------- | -------------------------- | -------------------- | ---------------------- |
| 150   | 62 ms/frame (16 fps) | **16.7 ms/frame (60 fps)** | 107 ms/frame (9 fps) | 128 ms/frame (7.8 fps) |
| 500   | 158 ms/frame (6 fps) | **16.7 ms/frame (60 fps)** | 220 ms/frame (5 fps) | 281 ms/frame (3.6 fps) |

One canvas surface in every case. `frameloop="demand"` removed the idle redraw loop entirely at
both fleet sizes; the playing cost is unchanged in nature (every frame is still drawn) and the
before/after delta there is software-renderer noise, not a code regression.

Interaction verification (canvas pixel-hash comparison): paused scene is byte-identical across
1.5 s, while seek, playback, OrbitControls, viewport selection (gizmo appearing) each redraw
immediately, and Presentation keeps animating its camera with no input.

Limitation: software rendering, so these numbers are only valid as a before/after comparison,
never as an fps promise on real GPUs.

## Re-measurement attempt (18 Sep 2026) — INCONCLUSIVE

Requested target `b91f3df17f2104cb52d34711d6a0ced442b5aad7` is **not present** in this sandbox
(`git cat-file` fails; `git fetch` has no credentials), so the removed duplicate lighting-sampling
path could not be exercised. Measured HEAD instead: `4e8f8b7` ("Added actionable image warnings").

Method (identical to the probe above): Playwright headless Chromium,
`--use-gl=swiftshader --enable-unsafe-swiftshader`, 1280×1800, a fresh **Classic arc** show
(launch grid + take-off + three SHOW moments + landing) with the template's authored lighting
(`pulse`, `rainbow`, `twinkle`) active, fleet set in the wizard Fleet step, 5 s rAF sample with the
first 5 frames discarded, once paused and once playing.

| Fleet | Paused                    | Playing (avg / median / max)   | Sampled frames | Playing baseline |
| ----- | ------------------------- | ------------------------------ | -------------- | ---------------- |
| 150   | 16.67 ms/frame (60 fps)   | 218.2 / 233.3 / 300.0 ms       | 21             | 128 ms/frame     |
| 500   | 16.67 ms/frame (60 fps)   | 454.1 / 533.3 / 683.3 ms       | 8              | 281 ms/frame     |

Paused behaviour is unchanged and ideal (one canvas, 60 fps idle, canvas byte-identical over 1.5 s).
Playing is **slower** than the recorded baselines, but the comparison is not valid as a regression
signal: the baseline ran a different authored show, this run adds three authored lighting effects,
and the target commit is absent. No conclusion about the optimisation can be drawn; the 500-drone
playback item stays open.

Interaction re-checks at 150 (canvas screenshot hashes): paused identical over 1.5 s; playback,
OrbitControls drag and seek each redraw; Presentation keeps animating its camera. Viewport selection
was not re-exercised (the centre click hit empty sky, so no redraw is the correct outcome there).
`toDataURL` comparison is unreliable on this WebGL canvas — use element screenshots.

Checks: lighting tests 13/13, typecheck clean, build clean. `bunx eslint` on
`src/lib/show/lighting` + `Viewport3D.tsx` reports 14 pre-existing Prettier-only errors in
`engine.ts`, `evaluate.ts`, `validate.ts` and `lighting.test.ts`; left untouched because this turn
was verification-only.

## Verificare browser 2026-09-18 (main @ 77c1105)

- ✅ New Show: 3 șabloane (Blank/Short opener/Classic arc) — structuri corecte, Review cu rezumat, EDIT fără alegere de șablon, texte EN/RO fără promisiuni de siguranță
- ✅ Copy/paste clipuri: meniu + Ctrl+C/V, identități noi, un Undo = un Paste, Copy fără history/dirty, TAKEOFF/LANDING fără Copy, Paste dezactivat explicat, inputuri neatinse
- ✅ Cauza meniului aparent blocat izolată: meniul se deschide, dar la anumite ancore eliberarea
  butonului dreapta cade pe un rând repoziționat sub cursor și îl activează; fix strict UI în lucru
- ✅ 1395 teste, typecheck, lint, build — toate curate

## Verificare browser 2026-09-18 (guard meniu contextual @ 878c992)

Probă Playwright reală (viewport 1600×1800, show: launch grid + take-off + 2 segmente + landing),
click dreapta cu gest real de mouse (`mouse.down`/`mouse.up`, fără pauză):

- ✅ marginea de jos a unui clip SHOW, înainte de Copy: meniul rămâne deschis, nicio comandă executată
- ✅ marginea de jos și partea de sus, după Copy: meniul rămâne deschis, zero clipuri inserate
- ✅ click stânga pe un rând execută comanda o singură dată (Copy)
- ✅ submeniuri: 2 declanșatoare, se deschid la hover și își arată rândurile
- ✅ tastatură: ArrowDown până la `Paste`, Enter execută exact un Paste
- ✅ un Paste = un Undo (numărul de clipuri revine exact)
- ✅ meniul pe zona liberă a cronologiei se deschide („Timeline · Add Formation Clip…”)
- ✅ 399 teste țintite (inclusiv noul caz DOM), typecheck, lint pe fișierele atinse, build — curate

Limitare: JSDOM nu poate reproduce geometria (fără layout și fără repoziționare la coliziune);
acel aspect rămâne verificabil doar în browser.

Verificat și pe fereastră scurtă (1280×820): marginea de jos a clipului înainte și după Copy —
meniul rămâne deschis, 0 clipuri inserate; click stânga execută o dată; 3 submeniuri (13 rânduri);
Enter pe `Paste` inserează exact 1 clip, un Undo îl elimină; meniul pe zona liberă a cronologiei se
deschide. Suita completă: 159 fișiere / 1396 teste / 1 skipped, fără instabilitate Radix/JSDOM la
această rulare.
