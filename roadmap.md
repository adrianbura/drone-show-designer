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
4. [x] Verificare UX/browser copy/paste (clip SHOW prin meniu și `Ctrl+C/V`, obiecte de scenă,
   TAKEOFF/LANDING fără Copy, Paste explicat când e indisponibil, un singur Undo). Defect deschis,
   raportat și nemodificat: obiectele de scenă lipite nu sunt selectate, pentru că
   `pasteDesignClipboard` citește ID-urile create înainte ca `editScene` să comite proiectul
   (`store.tsx:2556`, `:6229`). Necesită aprobare pentru o corecție în store.
5. [ ] Selecția obiectelor lipite în scenă (corecție în store, după aprobare).
6. [ ] Șabloane de show.
7. [ ] Efecte de lumină avansate.
8. [ ] Imagine → figură: contur/umplere și diagnostic de separare.
9. [ ] Cost de redare la 500 de drone (pauza este rezolvată; redarea rămâne grea).
10. [ ] Mentenanță: împărțire `store.tsx`, lint global, CI și Playwright.
11. [ ] Curățenie repository: ignorare și eliminare controlată `__pycache__`/`.pyc` urmărite.

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
- [ ] ~~Automatic beat detection~~ — dropped by the owner: show moments are authored manually, the manual BPM grid stays
- [ ] ~~.skyc export~~ — dropped: the target hardware loads ESSP, which the app already reads and writes byte-identically

## Browser frame-time probe (18 Sep 2026, headless software GL — not GPU-representative)

Method: Playwright headless Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader`,
1280×1800 viewport, launch grid + take-off + show segment + landing, fleet size set in the
Fleet size field, 5 s rAF sample (first 5 frames dropped), paused and playing.

| Fleet | Paused before | Paused after | Playing before | Playing after |
| --- | --- | --- | --- | --- |
| 150 | 62 ms/frame (16 fps) | **16.7 ms/frame (60 fps)** | 107 ms/frame (9 fps) | 128 ms/frame (7.8 fps) |
| 500 | 158 ms/frame (6 fps) | **16.7 ms/frame (60 fps)** | 220 ms/frame (5 fps) | 281 ms/frame (3.6 fps) |

One canvas surface in every case. `frameloop="demand"` removed the idle redraw loop entirely at
both fleet sizes; the playing cost is unchanged in nature (every frame is still drawn) and the
before/after delta there is software-renderer noise, not a code regression.

Interaction verification (canvas pixel-hash comparison): paused scene is byte-identical across
1.5 s, while seek, playback, OrbitControls, viewport selection (gizmo appearing) each redraw
immediately, and Presentation keeps animating its camera with no input.

Limitation: software rendering, so these numbers are only valid as a before/after comparison,
never as an fps promise on real GPUs.
