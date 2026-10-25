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

### Referință funcțională ESSP — show-ul real cu 150 de drone

Arhiva ESSP furnizată de owner este benchmark-ul principal pentru limbajul show-ului, nu doar o
mostră de format binar. Evoluția editorului trebuie să pornească din comportamente observabile în
acel show: succesiunea formațiilor, felul în care punctele construiesc și desfac imaginile,
tranzițiile și traiectoriile, ritmul, staționările, efectele LED și schimbările de culoare.

Analiza existentă a validat formatul, cele două ceasuri ESSP, playback-ul, importul, forensics și
conversia segmentelor, dar nu constituie încă un catalog complet al gramaticii vizuale a show-ului.
Nu declarăm o funcție „inspirată din ESSP” fără o observație măsurată și trasabilă la segmentul din
referință. Nu copiem datele sau formatul proprietar; extragem principii generice de authoring.

## Mod de lucru

- ChatGPT coordonează proiectul ca Project Manager tehnic și menține sincronizate acest roadmap
  și `HANDOFF.md` în aceeași intervenție și același commit după fiecare schimbare relevantă;
  modifică `AGENTS.md` doar când se schimbă reguli stabile, nu pentru progresul curent.
- Pentru dezvoltare, folosește direct instrumentele repo: inspectează fișierele și identifică
  cauza înainte de delegare, implementează când instrumentele permit, adaugă/actualizează teste
  și rulează verificările accesibile; descrierile și prompturile singure nu încheie sarcina.
- Comanda utilizatorului **„continuă”** pornește următorul element executabil din secțiunea
  „Prioritate curentă”, cu implementare, teste și actualizarea documentației de stare.
- Lovable oferă ajutor complementar printr-un prompt delimitat pentru o sarcină vizuală
  sau independentă; diff-ul și dovezile verificărilor sunt inspectate înainte de bifare.
- Repository-ul GitHub este memoria canonică între conversații. După fiecare etapă materială,
  `HANDOFF.md` păstrează deciziile, verificările, blocajele și următorul pas exact, iar acest
  roadmap păstrează ordinea și starea priorităților.
- O conversație nouă începe prin citirea `AGENTS.md`, `HANDOFF.md` și `roadmap.md`, apoi prin
  verificarea ultimului commit (`git log -1`), `git status`, `git diff` și codului relevant,
  în această ordine; nu reconstruiește planul din memorie sau presupuneri.
- Raportarea include comenzile exacte rulate, rezultatele, verificările/instrumentele indisponibile,
  limitele și următorul pas; nu declară modificări, verificări sau funcții complete fără dovezi.
  Istoricul Git publicat nu se rescrie.

## Prioritate curentă

0. [x] Refacere regie „A & B — Wedding Story” ca poveste născută dintr-un cer de stele.
   - [x] Deschidere cu toate cele 200 de drone ca boltă stelară și Carul Mare lizibil.
   - [x] Imaginile folosesc numai numărul necesar de drone; restul se sting și pregătesc discret scena următoare.
   - [x] Countdown-ul folosește un singur inel clar, nu repetiții inutile.
   - [x] Inima de nuntă are contur și umplere, cu pulsație vizuală de bătaie.
   - [x] Verificare prin deschidere reală în editor, redare și analiză completă a show-ului.
   - [x] „Two Destinies” refăcut după referința furnizată: portret liniar mire–mireasă cu 120 de drone,
         orientat spre public; 80 de drone rămân stinse în pregătire.
   - [ ] Remediere separată de zbor: analiza 10 Hz este FAIL/BLOCKED (299 erori, 210 avertismente,
         1.231 conflicte); designul nu este ESSP-ready și nu este autorizat pentru zbor.
1. [ ] Benchmark ESSP 150 drone — transformarea show-ului real într-o specificație de produs.
   - [x] Arhiva brută a fost reatașată și verificată; nu este păstrată în repository.
   - [x] Inventar temporal inițial: formații, tranziții, hold-uri, takeoff/landing și momente-cheie.
   - [x] Analiză cinematică inițială: convergență/divergență, rotație, scalare,
         deformare, viteze și easing observabil.
   - [ ] Analiză LED aprofundată: palete, sweep-uri, gradient, sincronizare și relația culoare–mișcare
         (inventarul inițial confirmă 100+ culori simultane și evoluție continuă). Următorul pas
         executabil: audit măsurat al direcției/vitezei gradientelor și al sincronizării RGB cu XYZ,
         apoi mapare la capabilități și criterii de acceptare; importul experimental rămâne oprit.
   - [x] Etapă read-only RGB spațial (2026-10-25): fit XYZ/RGB pe ceasul original RGB,
         coerență liniară, direcție/putere numai cu suport stabil, schimbare și derivă aparentă
         condiționată; UNKNOWN pentru rețetă. 10 regresii sintetice. Salvarea reală: 150 drone,
         23 bindinguri, 5.841 ticks, 598 ms total / 93 ms maximum, fără mutarea sursei/raportului.
         Metrici disponibile în `lighting.spatial`, nu încă afișate; LED aprofundat rămâne deschis.
         Final: 13 teste țintite, 89 downstream, 164 fișiere / 1432 passed / 1 skipped;
         lint schimbări și diff-check curate; build automat OK. Typecheck/build manual neexecutate.
   - [x] Diagnostic RGB vizibil (2026-10-25): integrat în inspectorul scenei, EN/RO,
         acoperire XYZ/RGB, fit disponibil, axă/gradient/evoluție numai cu suport;
         uniform/insuficient/low-fit/indisponibil explicite, rețeta necunoscută.
         20 teste țintite, 77 downstream, 1439 passed / 1 skipped în suita completă;
         lint curat, build automat OK; desktop și inspector mobil 390/320 px verificate.
         Salvarea reală disponibilă: fit mediu 21,4%, fără gradient declarat, zero erori browser.
   - [x] Audit RGB read-only per interval pe ZIP-ul owner disponibil (2026-10-25):
         SHA-256 0055f8ce…, 150/150 fișiere byte-identice, 279 rezumate (21 benchmark,
         138 segmente forensics, 119 ferestre + show întreg), JSON/Markdown reproductibile.
         99,9719% probe pereche; 7116 ticks cu fit slab pe cel puțin un canal;
         niciun gradient unic susținut. Nu echivalează fără checksum cu istoricul `(5).zip`.
         19 teste țintite, 83 downstream, 1445 passed / 1 skipped global; lint curat.
   - [ ] Diagnostic local/grup-condiționat cu suport și verificare held-out pentru cazuri
         low-fit; nu inventa efecte și nu relaxa pragurile globale. Detalii în HANDOFF.md.
   - [ ] Audit separat `wedding-sorin-frg-no-movement.zip` — BLOCAT la 2026-10-25:
         absent numai din sandboxul Lovable; accesibil în mediul chatului la `/mnt/data`.
         Ownerul raportează 2.251.837 bytes, SHA-256
         e7a4246016b3aa175e020858a7cf9406f72c38c99f090ab9ada702e97cea558f,
         150 ESSP reale + AppleDouble, header XYZ 4 Hz/RGB 12 Hz. Lista completă de ID-uri
         rămâne necunoscută (exemple 13/44/52); inventarul raportat 304 necesită reconciliere
         cu cele 303 intrări enumerate pe categorii. Compatibilitate/audit local neverificate.
         CLI curent cere 150 drone, 8/12 Hz și adaugă intervalele benchmark necondiționat;
         înainte de audit verifică parserul și folosește intervale proprii pentru alt show,
         fără să suprascrii/reprocesezi benchmark-ul. Reverificare: 19 teste passed, lint curat;
         doar HANDOFF + roadmap modificate. CLI nu are încă mod generic, în ciuda titlului
         commitului 692052e; transferă arhiva în Lovable, verifică hashul înainte de decodare,
         exclude AppleDouble și testează un mod fără intervale benchmark înainte de audit.
         Detalii și proveniența separată a dovezilor în HANDOFF.
         Corecție 08:13 UTC: comanda Vitest cu rgbAudit/spatialRgb/sceneEvidence și
         `--maxWorkers=2`: 3 fișiere, 19 passed, 1,33 s; ESLint pe CLI/rgbAudit/test exit 0;
         `git diff 692052e6ea51657244d95a9e8f124a014a807eb2 --check` exit 0,
         diff numai HANDOFF/roadmap. Suita completă/browser neexecutate (documentație);
         typecheck/build manual nepermise și neexecutate. Niciun audit real nou.
   - [x] Catalog inițial „pattern observat → capabilitate existentă → lipsă → criteriu de acceptare”
         în `docs/ESSP_SHOW_BENCHMARK.md`.
   - [x] Confirmarea planului comun de prezentare: majoritatea imaginilor au pitch/tilt ~14–15°,
         aproximativ `Z = −0.26 × Y + constant`; cerință pentru authoring proiectat spre public.
   - [x] Reprioritizarea inițială: storyboard de referință, tranziții, iluminare spațială și
         compoziție multi-parte înaintea funcțiilor speculative.
2. [x] Viewport invalidate-on-demand implementat: editor tehnic `demand`, Presentation `always`.
3. [x] Re-măsurare browser 150/500 și verificare seek/playback/controls/selecție/Presentation.
4. [x] Copy/paste intern pentru clipuri SHOW și obiectele scenei (ID-uri noi, un singur Undo).
5. [x] Verificare UX/browser copy/paste; cauza meniului aparent blocat a fost izolată la
       eliberarea butonului dreapta peste un rând repoziționat sub cursor.
6. [x] Șabloane de show: Blank, Short opener și Classic arc în New Show.
7. [x] Verificare UX/browser pentru șabloane.
8. [x] Gard UI pentru eliberarea butonului dreapta în meniul contextual; verificat în browser.
9. [ ] Efecte de lumină avansate.
   - [x] Editor multi-stop pentru gradientele `COLOR_SWEEP` în inspectorul unificat, verificat în browser.
   - [ ] Ancoră temporală și mod de blend în inspectorul unificat.
10. [x] Imagine → figură: contur/umplere și diagnostic de separare.
    - [x] Import local, Contur/Structural/Umplut și compilare deterministă exact-N există.
    - [x] Afișarea distanței minime și a avertismentelor compilatorului în panoul imaginii.
    - [x] Verificare browser pentru contur/umplere, diagnostic și salvare în bibliotecă.
    - [x] Rezumat clar/atenție, severitate textuală și ghidaj corectiv localizat EN/RO.
11. [ ] Cost de redare la 500 de drone (pauza este rezolvată; redarea rămâne grea).
    - [x] Eliminarea eșantionării duble a traiectoriilor pe cadru când iluminarea este activă.
    - [ ] Re-măsurare browser la 150/500 drone și profilarea următorului hotspot.
12. [ ] Mentenanță: împărțire `store.tsx`, lint global, CI și Playwright.
13. [ ] Curățenie repository: ignorare și eliminare controlată `__pycache__`/`.pyc` urmărite.
14. [ ] **Reconstrucție automată fidelă la import ESSP** — fiecare scenă cu imagine corectă,
    mișcare dinamică, lumină/culoare, tranziții și intervale, păstrând traiectoriile originale.
    Utilizatorul NU trebuie să repare scenele manual; delimitarea este o parte a obiectivului,
    nu obiectivul complet. Numai dovezi sursă; rețetele efectelor nerecunoscute = necunoscute.
    Criterii complete în `HANDOFF.md`; experimentalul rămâne dezactivat implicit.
    - [x] Increment 4: dovezi per scenă selectată, proiecție frontală XYZ/RGB din sursă,
          intervale deduse, clasificare mișcare, statistici RGB și rețetă explicit necunoscută.
          163 fișiere / 1418 teste passed, 1 skipped; browser castel + Unknown verificate.
    - [ ] Reconstrucție completă verificată automat pentru toate scenele, fără reparații manuale:
          geometrie/preview, dinamică, LED exacte și tranziții; recunoaștere conservatoare
          de rețete doar cu dovezi; necunoscutele și limitele rămân vizibile.
    - [x] Increment conservator: proiecție separată de identitate geometrică, deterministă,
          fără schimbarea raportului, schemelor sau datelor ESSP; 6 regresii noi.
    - [x] Verificare pe proiectul salvat: inimă 251,25–280,50 s, tranziție 280,50–292,00 s,
          castel 292,00–322,25 s; 150/150 fișiere originale identice.
    - [x] Increment 2: recuperarea prefixului compatibil absorbit în run-ul mixt, fără
          schimbarea motorului; pe salvarea reală inimă până la 281,00 s, tranziție până
          la 292,00 s. 162 fișiere / 1413 teste trecute, 1 skipped; sursa 150/150 identică.
    - [x] Increment 3: audit temporal integral 26 clipuri și eliminarea episodului incert
          duplicat 122,00–132,25 s; 25 clipuri după corecție, continue 0–486,75 s.
          1415 teste trecute / 1 skipped; inima dinamică verificată pe 18.000 poziții.
    - [ ] Activare în importul normal: blocată de incompatibilitățile de editare la reunirea
          clipurilor statice cu cele dinamice; implementarea este opt-in tehnic, nu UI.
    - [x] Reprezentare compatibilă STATIC/DYNAMIC pentru episoadele grupate; fixture-urile
          disting translația rigidă de o imagine nouă. Integrat în main prin PR #5
          (commit 3851931). Lovable a raportat 1.422 teste trecute / 1 skipped și lint
          curat pe cele patru fișiere; nu există CI status disponibil pentru commitul de merge.
    - [ ] Identitate pentru deformări locale/porumbei și imagini schimbate prin drone active;
          rafinarea completă a run-urilor mixte (prefixul confirmat este recuperat) și
          verificare vizuală integrală a celor 25 clipuri opt-in; auditul numeric este
          terminat, dar etichetarea imaginilor și porumbeii nu sunt validate integral.
    - [ ] Split/merge temporal cu un Undo și aplicarea reanalizei fără pierderea editărilor.

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

- [x] Audit RGB read-only `wedding-sorin-frg-no-movement.zip` (SHA `e7a42460…`, XYZ 4 Hz / RGB 12 Hz, AppleDouble exclus, mod `--generic`, raport `docs/audits/wedding-sorin-e7a42460/`). Mod generic: ID-uri neconsecutive unice, duplicate respinse, testat. Următor: comparație intervale între cele două show-uri.
