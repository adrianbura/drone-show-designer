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
   - [x] Editor multi-stop pentru gradientele `COLOR_SWEEP` în inspectorul unificat — verificat în
         browser (vezi „Verificare browser 2026-09-18 — editor gradient multi-stop”).
9. [ ] Imagine → figură: contur/umplere și diagnostic de separare.
10. [ ] Cost de redare la 500 de drone (pauza este rezolvată; redarea rămâne grea).
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

## Verificare browser 2026-09-18 — editor gradient multi-stop (main @ 563b546)

Probă Playwright reală (Chromium headless, 1600×1800 și 1280×820; show „Depth Stagger Demo”, clip
SHOW `c-ds-approach`, obiect de scenă selectat, `Gradient sweep` adăugat și aplicat din previzualizare):

- ✅ inspectorul arată toate stopurile canonice, cu culoare și poziție 0–100%
- ✅ „Add stop” inserează în cel mai mare interval (50%) cu culoare interpolată (#ffc878 + #5078ff → #a8a0bc)
- ✅ eticheta de culoare din cronologie se schimbă după adăugare
- ✅ editarea culorii se aplică; pozițiile se limitează la 0% și 100% și rămân ordonate, inclusiv la
  o mutare în interval (0 / 20 / 50%) care reordonează stopurile
- ✅ eliminarea funcționează și se oprește la minimul canonic de două (butoanele devin inactive)
- ✅ Undo/Redo exact pentru adăugare, culoare, mutare și eliminare (9/9 verificări țintite)
- ✅ persistență: gradientul cu trei stopuri se salvează în fișierul de proiect și se regăsește
  identic după reîncărcare și redeschidere
- ✅ fără regresii: Colour A/B, direcția gradientului, axa din inspector, selecția cu click stânga,
  duplicarea efectului și redarea previzualizării
- ✅ accesibil și pe fereastră scurtă (1280×820): editorul e vizibil după derulare (132×229 px)
- ✅ 1399 teste / 1 skipped, typecheck, lint pe fișierele atinse, build — curate

Observație de metodă (nu defect): scurtăturile de tastatură sunt ignorate corect cât timp focalizarea
e într-un câmp de introducere, deci Undo se verifică numai după ce câmpul de culoare pierde focusul.
