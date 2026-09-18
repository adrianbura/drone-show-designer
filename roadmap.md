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
3. [ ] Copy/paste pentru clipuri și scene, apoi șabloane de show.
4. [ ] Efecte de lumină avansate.
5. [ ] Imagine → figură: contur/umplere și diagnostic de separare.
6. [ ] Cost de redare la 500 de drone (pauza este rezolvată; redarea rămâne grea).
7. [ ] Mentenanță: împărțire `store.tsx`, lint global, CI și Playwright.
8. [ ] Curățenie repository: ignorare și eliminare controlată `__pycache__`/`.pyc` urmărite.

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
- [ ] ~~Automatic beat detection~~ — dropped by the owner: show moments are authored manually, the manual BPM grid stays
- [ ] ~~.skyc export~~ — dropped: the target hardware loads ESSP, which the app already reads and writes byte-identically

## Browser frame-time probe (18 Sep 2026, headless software GL — not GPU-representative)

| Fleet | Paused | Playing |
| --- | --- | --- |
| 150 | 62 ms/frame (16 fps) | 107 ms/frame (9 fps) |
| 500 | 158 ms/frame (6 fps) | 220 ms/frame (5 fps) |

One canvas surface in both cases (the two-instanced-surface contract holds). The idle
cost proves the viewport redraws continuously even when nothing moves — the first real
optimisation target, independent of the software renderer.
