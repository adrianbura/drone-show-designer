# Drone Show Designer — Handoff / Stare actuală

> Document de predare pentru un al doilea asistent (ChatGPT) conectat la același repo GitHub
> (`adrianbura/drone-show-designer`, branch `main`). Scop: să știe unde am rămas, ce reguli
> se respectă și ce mai trebuie făcut.

## 0. Protocol de colaborare ChatGPT ↔ Lovable

### Obiectiv funcțional obligatoriu — import automat fidel (clarificare 2026-10-24)

La importul unui show, aplicația trebuie să reconstruiască automat FIECARE scenă cu imagine/
previzualizare corectă, efectele de lumină și culoare, mișcarea dinamică, tranzițiile dintre
scene și intervalele temporale, păstrând traiectoriile originale ale dronelor. Utilizatorul
NU trebuie să repare scenele manual. Acesta este criteriul de finalizare, nu simpla
delimitare inimă→castel și nu existența unui algoritm opt-in.

ESSP observat conține XYZ int16 și RGB uint8 per dronă, cu ceasuri independente; nu conține
storyboard, nume de imagini sau rețete/parametri de efecte lizibili. Profilul de 13 octeți
și uint16 de la offset 23 sunt necunoscute și se păstrează. Se reconstruiește rezultatul
observabil, nu se inventează un autor sau un efect. Recunoașterea incertă rămâne explicit
necunoscută, iar RGB original nu este pierdut doar pentru că rețeta nu este recunoscută.

Acceptare: toate scenele/limitele și preview-urile verificate față de sursă, mișcarea și
LED originale păstrate la redare/save/open/export, tranzițiile distincte, necunoscute vizibile,
fără reparații manuale obligatorii; regresii generice și măsurători la scara reală.
Experimentalul nu se activează implicit până atunci. Importul actual NU îndeplinește încă
acest obiectiv complet. Split/merge viitor este opțional pentru autor, nu remediu obligatoriu.

- ChatGPT are rolul de **Project Manager tehnic**: analizează starea reală din repository,
  stabilește următorul pas justificat, lucrează direct cu codul și verifică rezultatul.
- La începutul fiecărei conversații noi, citește în ordine `AGENTS.md`, `HANDOFF.md`,
  `roadmap.md`, apoi verifică ultimul commit (`git log -1`), `git status`, `git diff`
  și codul relevant; nu reconstruiește starea din memorie sau presupuneri.
- Pentru cereri de dezvoltare, ChatGPT folosește instrumentele repo disponibile, inspectează
  fișierele și identifică cauza înainte de delegare. Când instrumentele permit, implementează
  efectiv modificarea, adaugă/actualizează teste și rulează verificările accesibile; nu se
  limitează la prompturi pentru Lovable sau la descrierea modificărilor necesare.
- `HANDOFF.md` și `roadmap.md` se actualizează împreună la fiecare intervenție relevantă,
  în același commit. `AGENTS.md` se modifică doar pentru reguli stabile, nu pentru starea
  proiectului, astfel încât instrucțiunile și progresul să nu se contrazică.
- Când utilizatorul spune **„continuă”**, ChatGPT alege primul pas executabil cu valoare maximă
  din roadmap, verifică mai întâi codul existent, apoi implementează fără a cere reconfirmarea
  priorității. Dacă există un blocaj real sau o decizie de produs ireversibilă, îl raportează
  înainte de implementare.
- Lovable este ajutor complementar pentru o sarcină delimitată, după inspecția directă a repo-ului,
  nu înlocuitorul lucrului cu codul. ChatGPT poate redacta un prompt când sarcina se potrivește
  fluxului vizual sau poate fi separată fără două autorități concurente. Promptul trebuie
  să includă scopul, fișierele permise, invariabilele, criteriile de acceptare și verificările.
- ChatGPT inspectează diff-ul și dovezile verificărilor produse de Lovable înainte de acceptare și
  actualizează documentele numai după ce starea raportată este susținută de cod și verificări.
- Nu afirmă modificări, verificări sau funcții complete fără dovezi. Raportează comenzile exacte
  executate, rezultatele reale, verificările/instrumentele indisponibile, limitele și următorul
  pas; o comandă neexecutată sau o verificare parțială nu devine succes declarat.
- Nu se rescrie istoricul publicat și nu se fac schimbări speculative în motoarele canonice.

### North Star de produs

Obiectivul principal este ca aplicația să devină **profesională și ușor de folosit**.
Aceste două calități sunt obligatorii împreună:

- **Profesională** înseamnă date coerente, rezultate deterministe, terminologie onestă,
  performanță măsurată, validări explicabile, interoperabilitate verificată și fluxuri în care
  operatorul poate avea încredere.
- **Ușor de folosit** înseamnă un traseu clar de la deschiderea proiectului la livrare, o singură
  sursă vizibilă de adevăr, acțiuni ușor de găsit, feedback imediat, erori recuperabile și
  complexitate avansată afișată numai când este necesară.
- O funcție nu este considerată terminată doar pentru că există în cod. Trebuie să fie accesibilă
  în fluxul operatorului, să aibă stări goale/loading/eroare clare, să fie testată și documentată.
- La prioritizare, se preferă eliminarea contradicțiilor și a fricțiunii din fluxurile principale
  înaintea adăugării de funcții izolate care măresc suprafața produsului.

### Autoritate de referință: arhiva ESSP cu 150 de drone

Ownerul a clarificat că show-ul real din arhiva ESSP trebuie folosit la maximum drept benchmark
funcțional pentru aplicație: efecte, schimbări de culoare, mișcări, formarea/desfacerea imaginilor,
tranziții, ritm și logică de show. Reverse-engineering-ul containerului nu este suficient.

Ce este deja solid: cele 150 de fișiere per-dronă au fundamentat formatul observat, axele/scara,
ceasurile independente 8 Hz poziție / 12 Hz RGB, playback-ul determinist, importul read-only,
forensics, segmentarea și conversia măsurată. Vezi `docs/ESSP_REFERENCE_FORMAT.md` și
`docs/ESSP_REFERENCE_FORENSICS.md`.

Lacuna recunoscută: nu există încă un catalog trasabil al gramaticii vizuale a show-ului care să
lege fiecare pattern observat de capabilitățile editorului și de lipsurile sale. Aceasta devine
prioritatea zero înaintea extinderilor speculative. Pentru fiecare segment trebuie măsurate:
geometria/formația, corespondența dronelor, tipul tranziției, mișcarea globală și deformarea,
hold-urile, paleta și dinamica LED, apoi rezultatul trebuie tradus în cerințe și teste generice.

Arhiva a fost reatașată la 2026-09-21 și analizată read-only. Rezultatul de produs este în
`docs/ESSP_SHOW_BENCHMARK.md`: 150/150 fișiere valide și byte-perfect la round-trip, show de
593.25 s, structură repetată de formații lungi (~38–45 s) despărțite de tranziții majore (~7–12 s),
mișcare locală în hold-uri și iluminare per-dronă foarte bogată (peste 100 de culori simultane în
mai multe cadre; până la 146 culori lit distincte în eșantionarea pe secunde). Prioritatea de produs
devine storyboard-ul geometry+LED, authoring-ul tranzițiilor global/local și iluminarea spațială.
Arhiva brută rămâne în afara repository-ului; nu se copiază payloadurile sau traiectoriile.

O verificare 3D ulterioară a confirmat o regulă structurală suplimentară: cadrele reprezentative
folosesc în majoritate un plan de prezentare înclinat cu aproximativ 14–15° față de planul frontal.
În coordonate studio, `Z ≈ −0.26 × Y + constant`, cu aport X aproape nul; partea superioară a
imaginii se deplasează spre −Z. Editorul trebuie să modeleze explicit planul de prezentare către
public (inclusiv pitch/tilt), nu să presupună că toate figurile sunt plate în world X–Y.

### Continuitate între conversații

Repository-ul este memoria canonică a proiectului; memoria unei conversații nu este o
dependență. Înainte de închiderea unei etape și după orice schimbare materială, ChatGPT
actualizează acest document și `roadmap.md` cu suficiente informații pentru reluare fără
istoricul conversației.

Fiecare actualizare de handoff trebuie să consemneze, după caz:

1. obiectivul și motivul deciziei;
2. ce s-a implementat și în ce fișiere;
3. ce s-a decis explicit și ce alternative au fost respinse;
4. verificările rulate și rezultatele lor exacte;
5. limitările, riscurile și blocajele rămase;
6. modificările nefinalizate sau nepublicate;
7. următorul pas concret, suficient de precis pentru un alt asistent.

La începutul unei conversații noi, asistentul trebuie să citească în această ordine:

1. `AGENTS.md`;
2. `HANDOFF.md` integral;
3. `roadmap.md`;
4. `ARCHITECTURE.md` și documentele specifice sarcinii curente;
5. starea Git, ultimul commit și diferențele nepublicate disponibile.

Asistentul verifică întotdeauna afirmațiile din handoff în cod. Dacă documentația și codul se
contrazic, codul și testele au prioritate, iar documentația este corectată în aceeași etapă.
O sarcină nu este raportată drept finalizată până când starea relevantă nu este persistată în
repository-ul GitHub folosit și de Lovable.

### Snapshot de reluare

- **Rol curent:** ChatGPT = Project Manager tehnic; Lovable = colaborator de implementare/UI
  folosit prin prompturi delimitate și verificat ulterior.
- **Obiectiv principal:** aplicație profesională și ușor de folosit.
- **Ramură canonică:** `main`; nu se rescrie istoricul publicat.
- **Ultima stare analizată:** `main` la `11c7619` („Analiza show-ului importat"); arborele de lucru
  este curat, iar documentele de stare au fost sincronizate la 2026-10-24.
- **Lucru curent:** defectul de delimitare a scenelor la importul ESSP (porumbeii fragmentați,
  pulsațiile inimii absorbite, „inimă → castel" într-un singur obiect) este confirmat pe proiectul
  salvat și redeschis de owner; soluția este specificată, dar NU este încă implementată.
- **Prioritate activă:** refacerea delimitării scenelor la import pe modelul „imagine vs. mișcare
  internă", pentru toate scenele și toate importurile (detalii în secțiunea finală).
- **Datorii deschise:** lumina `fx-ab-04b` a portretului mire–mireasă nu apare în vizualizare
  (cauză neidentificată); analiza full-show a show-ului A & B rămâne `FAIL/BLOCKED`; toate cifrele
  de performanță provin din Playwright headless cu SwiftShader, deci nu sunt o promisiune de fps.
- **Comandă de reluare:** când utilizatorul spune „continuă”, se pornește prioritatea activă din
  `roadmap.md`, verificând mai întâi dacă Lovable a publicat între timp un commit nou.

## 1. Ce este aplicația

Studio web pentru proiectarea, validarea și exportul de show-uri cu drone luminoase.
Stack: **TanStack Start v1 + React 19 + Vite 7 + Tailwind v4 + React Three Fiber**.
Fără backend momentan (fără Lovable Cloud / Supabase) — totul rulează client-side,
proiectele se salvează/încarcă ca fișier `.dsp.json`.
Există și un serviciu Python separat, `simulation_bridge/` (FastAPI), pentru simulare
(mock, MDS, PX4-SITL) — nu e obligatoriu pentru editor.

## 2. Harta codului

| Zonă                     | Locație                                                                                 | Rol                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domeniu pur (fără React) | `src/lib/show/**`                                                                       | formații, assignment, trajectory, transition, safety, fullshow, lighting, dynamic, geo, svg, text, scene, preshow                                |
| Stat + autorități UI     | `src/lib/studio/**`                                                                     | `store.tsx` (canonic), history/undo, autorități pure (`effectCatalog`, `phaseEditor`, `clipPhaseNotice`, `siteGeofence`, `workspaceSections`, …) |
| Export/import            | `src/lib/adapters/**`, `src/lib/import/essp/**`                                         | JSON documentat, CSV, ESSP, simulation handoff, preflight                                                                                        |
| UI                       | `src/components/studio/**`                                                              | Timeline, Viewport3D, Inspector + panouri                                                                                                        |
| Rute                     | `src/routes/index.tsx`, `src/routes/__root.tsx`, `src/routes/api/generate-reference.ts` | o singură pagină de studio + un endpoint AI                                                                                                      |
| Docs                     | `ARCHITECTURE.md`, `docs/*.md`                                                          | contracte de format, forensics ESSP, design vizual                                                                                               |
| Plan/istoric             | `.lovable/plan/*.md`                                                                    | planuri aprobate (inclusiv propunerile A–D)                                                                                                      |

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

## 5. Ce mai trebuie făcut (stare reală, 15 sep 2026)

GATA între timp (nu se mai reface): traseu ghidat „Show setup”, decolare/aterizare automate,
blocarea exportului la breșă de perimetru GPS (cu test de regresie), text cu font real
(pack Archivo), bibliotecă de 10 figuri + sirena cu coadă animată, raport de validare PDF
descărcabil din panoul Show readiness. Refactorul de prezentare pentru importul ESSP real este
închis: TopBar, Timeline și panoul Show afișează aceeași flotă de referință, iar suprafețele
responsive Inspector/LeftPanel au exact o singură instanță montată. Există regresie DOM cu
150 de drone și teste pure pentru exclusivitatea montării. Modul Presentation este implementat
separat de editorul tehnic: cer negru, glow instanțiat, cameră lentă, cameră din poziția
publicului când aceasta există și fallback etichetat explicit ca estimare. Randarea păstrează
exact două suprafețe instanțiate la 150 și 500 de drone.

Ultima verificare locală (15 sep 2026): **158 fișiere Vitest trecute, 1384 teste trecute,
1 skipped**; typecheck, lint pe fișierele atinse și production build curate. Lint-ul global
rămâne datorie separată, dominată de abateri Prettier istorice.

GATA (18 sep 2026): **proba de frame-time în browser** la 150 și 500 de drone, cu Playwright
pe randare software (headless, SwiftShader — deci NU reprezentativ pentru GPU real):

| Flotă | Pauză                | Redare               |
| ----- | -------------------- | -------------------- |
| 150   | 62 ms/cadru (16 fps) | 107 ms/cadru (9 fps) |
| 500   | 158 ms/cadru (6 fps) | 220 ms/cadru (5 fps) |

O singură suprafață canvas în ambele cazuri. Costul în pauză este constatarea reală:
viewportul se redesenează continuu chiar când nimic nu se mișcă.

IMPLEMENTAT de ChatGPT (18 sep 2026), în așteptarea re-măsurării: Canvas-ul R3F folosește
`frameloop="demand"` în editorul tehnic și păstrează `frameloop="always"` numai în modul
Presentation, unde camera cinematică depinde de timpul real. Politica pură
`viewportFrameLoop()` este testată. Schimbările playhead-ului, ale selecției, geometriei și
controalelor invalidează cadrul prin React/R3F; o scenă tehnică oprită nu mai are motiv să
consume o buclă continuă.

Verificări pentru această schimbare (Lovable, 18 sep 2026, pe commitul de bază
`9c5b0aa` „Render technical viewport on demand"):

- test țintit `presentationViewport.test.ts`: **5/5 trecut**;
- suita completă `bunx vitest run --maxWorkers=2`: **158 fișiere trecute, 1385 teste trecute,
  1 skipped, 0 eșuate**. Eșecurile anterioare din `studioContextMenu.dom.test.tsx` nu mai
  apar în această rulare;
- `bunx tsgo --noEmit`: **trecut**;
- ESLint pe `Viewport3D.tsx` și `presentationViewport.ts`: **trecut**;
- `bun run build`: **trecut**.

### RE-MĂSURARE VIEWPORT — ÎNCHISĂ (18 sep 2026)

Metodă identică baseline-ului: Playwright headless Chromium cu `--use-gl=swiftshader
--enable-unsafe-swiftshader`, viewport 1280×1800, `http://localhost:8080`, show construit prin
„Set up launch grid" → „Add take-off" → „Add a show segment" → „Add landing", flotă setată din
câmpul „Fleet size", probă rAF de 5 s (primele 5 cadre aruncate), în pauză și în redare.

| Flotă | Pauză înainte        | Pauză după                 | Redare înainte       | Redare după            |
| ----- | -------------------- | -------------------------- | -------------------- | ---------------------- |
| 150   | 62 ms/cadru (16 fps) | **16,7 ms/cadru (60 fps)** | 107 ms/cadru (9 fps) | 128 ms/cadru (7,8 fps) |
| 500   | 158 ms/cadru (6 fps) | **16,7 ms/cadru (60 fps)** | 220 ms/cadru (5 fps) | 281 ms/cadru (3,6 fps) |

O singură suprafață canvas în ambele cazuri (contractul se păstrează). Câștigul urmărit este
obținut integral: editorul oprit nu mai produce cadre, la orice flotă. Costul în redare rămâne
de același ordin ca baseline-ul; diferența măsurată (107→128, 220→281 ms) este zgomot de
randare software, nu o regresie de cod — `frameloop="demand"` nu schimbă nimic în timpul redării,
unde fiecare cadru era și rămâne desenat.

Verificare de interacțiune (comparație hash pe pixelii canvas-ului, `/tmp/browser/interact/check.py`):

- scenă oprită: două capturi la 1,5 s distanță — **identice** (nicio buclă de cadre);
- seek pe timeline: **redesenează**;
- redare: două capturi consecutive **diferite** (animă);
- OrbitControls (drag): **redesenează**;
- selecție prin click în viewport (inclusiv apariția gizmo-ului): **redesenează**;
- Presentation fără nicio intrare: două capturi la 2 s distanță **diferite** — camera
  cinematică continuă să anime.

Limitări: cifrele sunt din randare software SwiftShader în sandbox headless, deci NU sunt
reprezentative pentru un GPU real; rămân valide doar ca bază de comparație înainte/după.
Costul în redare la 500 de drone este următoarea țintă reală de optimizare.

SCOASE din plan, decizie a proprietarului: detecția automată de bătăi (momentele se
compun manual, grila BPM manuală rămâne) și exportul `.skyc` (hardware-ul țintă
încarcă ESSP, format pe care aplicația îl citește și îl scrie deja bit cu bit).

Rămas, în ordinea de lucru:

1. **Verificare copy/paste în browser** — clip SHOW din timeline și selecție de obiecte din
   scenă; confirmă selecția rezultatului și un singur pas Undo pentru fiecare Paste.
2. **Verificare șabloane în browser** — selecție în New Show, rezumat în Review și timeline
   rezultat pentru Blank / Short opener / Classic arc.
3. **Efecte de lumină avansate** peste preseturile existente.
4. **Imagine → figură mai puternic** (contur vs. umplere, diagnostic de separare).
5. **Cost de redare la 500 de drone** — singura țintă de performanță rămasă după închiderea
   re-măsurării (pauza este rezolvată).
6. **Curățenie**: împărțirea `store.tsx` pe felii, lint global, CI și teste Playwright pe
   timeline/gizmo/viewport; `.gitignore` pentru `__pycache__`/`.pyc`.

### COPY/PASTE CLIPURI ȘI SCENE — IMPLEMENTAT (18 sep 2026)

- `Ctrl+C / Ctrl+V` folosește un clipboard intern sesiunii și nu scrie datele show-ului în
  clipboardul sistemului de operare;
- dacă sunt selectate obiecte vizuale, se copiază acele obiecte; altfel se copiază clipul SHOW;
- Copy este stare de editor, fără dirty/history; Paste creează ID-uri noi, selectează rezultatul
  și produce exact o singură revizie Undo;
- clipul păstrează snapshotul de la momentul Copy, scena, efectele de lumină și referințele
  interne remapate; asset-urile formation/dynamic rămân partajate și lipsa lor blochează Paste;
- meniul contextual al clipului oferă Copy/Paste, iar Paste explică de ce este indisponibil.

Validare locală:

- TypeScript `tsc --noEmit`: **trecut**;
- teste țintite: **47/47 trecute**;
- build producție: **trecut**, cu avertismentele istorice de chunk/directive;
- ESLint pe fișierele atinse: **0 erori**, 11 avertismente istorice în `store.tsx`;
- suită completă: **157 fișiere trecute, 1 eșuat; 1388 teste trecute, 2 eșuate,
  1 skipped**. Ambele eșecuri sunt testele Radix/JSDOM cunoscute din
  `studioContextMenu.dom.test.tsx`, care nu reușesc să deschidă meniul nici înaintea acestei
  schimbări; testele pure ale autorității meniului și copy/paste trec.

### ȘABLOANE DE SHOW — IMPLEMENTAT, ÎN AȘTEPTAREA VERIFICĂRII BROWSER (18 sep 2026)

- `src/lib/studio/showTemplates.ts` este registrul pur pentru `BLANK`, `SHORT_OPENER` și
  `CLASSIC_ARC`;
- Blank păstrează timeline-ul gol; celelalte șabloane compun TAKEOFF, două/trei momente SHOW și
  LANDING folosind exclusiv autoritățile canonice existente;
- alegerea este integrată în pasul Project al New Show și apare din nou în Review; editarea unui
  proiect existent nu oferă șabloane, ca să nu înlocuiască accidental munca utilizatorului;
- textele EN/RO spun explicit că șabloanele sunt puncte de pornire editabile, nu validări sau
  aprobări de siguranță.

Validare locală:

- TypeScript `tsc --noEmit`: **trecut**;
- teste țintite setup + templates: **16/16 trecute**;
- build producție: **trecut**, cu avertismentele istorice de chunk/directive;
- ESLint pe fișierele atinse: **0 erori**, aceleași 11 avertismente istorice în `store.tsx`;
- suită completă: **158 fișiere trecute, 1 eșuat; 1393 teste trecute, 2 eșuate,
  1 skipped**. Cele două eșecuri rămân exclusiv testele Radix/JSDOM cunoscute din
  `studioContextMenu.dom.test.tsx`.

## 6. Limitări cunoscute, de comunicat onest

- Aplicația **nu** autorizează zborul; validările sunt de design, nu certificare.
- AI Formation Creator este determinist/mock, nu un LLM real.
- Faza Formation nu are încă culoare și mișcare proprii.
- Proiectele vechi rămân plane (fără stagger pe Z) — compatibilitate păstrată.
- Testul `exportRecoveryIsolation` este skipped: verifica indentarea exactă din `store.tsx`.

## 7. Prompt de verificare pentru Lovable

```text
Sincronizează ultimul main și nu rescrie istoricul. În New Show verifică cele trei opțiuni de
structură inițială: Blank canvas, Short opener și Classic arc, inclusiv starea selectată și
rezumatul din Review. Creează pe rând fiecare variantă și confirmă timeline gol pentru Blank,
respectiv TAKEOFF + 2/3 SHOW + LANDING pentru celelalte, în ordinea corectă și fără referințe lipsă.

Confirmă că Show Setup pentru un proiect existent NU afișează șabloanele și că textele EN/RO nu
fac promisiuni de siguranță. Nu modifica motoarele show/trajectory/safety și nu crea o a doua
autoritate de timeline. Aplică doar corecții UI limitate; schimbările în store/core trebuie
raportate înainte. Actualizează HANDOFF.md și roadmap.md și rulează testele, typecheck, lint
relevant și build.
```

## VERIFICARE BROWSER — copy/paste + șabloane New Show (main @ 77c1105, 2026-09-18)

Metodă: Playwright headless Chromium/SwiftShader, viewport 1280×1800, scripturi în /tmp/browser/verify/ (newshow.py, kb.py, menubug*.py). Zero modificări de cod.

**New Show (toate PASS):** cele 3 opțiuni (Blank canvas / Short opener / Classic arc) cu stare selectată (aria-pressed) și rezumat în Review; Blank → timeline gol; Short opener → TAKEOFF+2 SHOW+LANDING; Classic arc → TAKEOFF+3 SHOW+LANDING, ordine corectă, fără referințe lipsă; Show Setup pe proiect deschis (mod EDIT) NU afișează alegerea de șablon; textele EN/RO spun explicit „not validated flight plans or safety approvals" / „nu planuri de zbor validate sau aprobări de siguranță".

**Copy/paste clipuri (PASS):** TAKEOFF/LANDING fără Copy; Paste dezactivat cu explicație „Copy a SHOW clip first."; Copy nu creează history/dirty; Ctrl+C/Ctrl+V pe clip lipește exact o dată per apăsare, identități noi, un singur Undo elimină întregul Paste; shortcuturile nu interceptează Ctrl+C/V în inputuri (valoare „abcabc" corectă).

**DIAGNOSTIC CORECTAT (UI-only):** nu există stare Radix blocată. Trasarea cu mouse real la
1600×1800 a arătat că `contextmenu` deschide corect meniul și starea modală este curățată. Când
meniul se repoziționează în sus, un rând poate apărea sub cursor; `pointerup` pentru butonul 2
ajunge pe acel rând, îl activează și închide imediat meniul. De aceea evenimentul sintetic părea
să funcționeze: nu are o eliberare ulterioară a butonului. Problema se reproduce și în stare
curată, în funcție de punctul de ancorare; Copy doar schimbă geometria prin apariția Paste.

Cauze eliminate prin trasare: cleanup modal/dismissable layer, meniurile Radix imbricate,
pointer capture al timeline-ului, ordinea `stopPropagation` și stare open stale. Remedierea minimă
este în `StudioContextMenu.tsx`: contentul principal și submeniurile opresc în capture doar
`pointerup` non-primar, înainte ca itemul să-l transforme într-o selecție. Poziționarea,
click-stânga, tastatura, submeniurile și autoritatea command/store rămân neschimbate.

Testul DOM țintit pentru gard trece izolat; fișierul Radix/JSDOM rămâne instabil când toate
cazurile rulează împreună, limitare deja cunoscută. Verificarea decisivă rămâne Playwright cu
click-dreapta la marginea inferioară a clipului, după publicarea fixului.

**Verificări:** 159 fișiere / 1395 teste trec (1 skipped), tsgo curat, eslint curat pe Timeline/SetupWizard/showTemplates, build OK.

## Guard meniu contextual — VERIFICAT (2026-09-18, main @ 878c992)

Cauza reală: meniul se deschidea corect, dar la anumite ancore repoziționarea punea un rând exact sub
cursor, iar eliberarea butonului dreapta (același gest care deschide meniul) activa acel rând.
Excluse prin trasare: cleanup dismissable-layer (body pointer-events și aria-hidden se restaurau
complet), declanșatoare imbricate, pointer capture pe track, ordinea handlerelor pe clip, stare open
învechită.

Fix (doar prezentare): `StudioContextMenu` ignoră în faza de capture eliberările de pointer care nu
vin de la butonul principal, pe conținutul meniului și al submeniului.

Verificat în browser (gest real de mouse, fără pauză): marginea de jos a clipului înainte și după
Copy — meniul rămâne deschis, nicio comandă și niciun Paste executat; click stânga execută o dată;
submeniuri funcționale; Enter pe `Paste` execută exact un Paste; un Paste = un Undo; meniul pe zona
liberă a cronologiei se deschide. 399 teste țintite, typecheck, lint și build curate.

## ILUMINARE AVANSATĂ — EDITOR GRADIENT MULTI-STOP (verificat, 2026-09-18)

Primul increment al priorității „Efecte de lumină avansate” extinde inspectorul unificat pentru
efectele canonice `COLOR_SWEEP`: operatorul poate adăuga stopuri, schimba poziția 0–100%, culoarea
și elimina stopuri până la minimul canonic de două. Nu există model sau evaluator nou;
`LightingEffectParameters.stops` rămâne unica autoritate, iar store-ul existent aplică fiecare
editare în istoricul proiectului.

Logica pură din `src/lib/studio/effectStack.ts` normalizează pozițiile în 0–1, păstrează ordinea,
inserează în cel mai mare interval și interpolează culoarea nouă. Testele pure și testul DOM al
Scene Composer acoperă adăugare, repoziționare, eliminare și limita de două stopuri. Typecheck,
lint relevant și build sunt curate. Lovable a verificat în browser adăugarea în cel mai mare
interval cu interpolare, clamp/reordonare 0–100%, limita de două stopuri, Undo/Redo, persistența,
swatch-ul cronologiei, controalele vechi și accesibilitatea la 1280×820.

Inspectorul unificat expune acum și `anchor` (`ABSOLUTE`, `SCENE_START`, `FORMATION_READY`,
`SCENE_END`) plus `blendMode` (`REPLACE`, `MULTIPLY_INTENSITY`, `ADD`) direct pe instanța canonică
de efect. Nu există conversii sau evaluator alternativ; schimbările merg prin `patchLightingEffect`
și istoricul existent. Testul DOM confirmă persistența valorilor și pașii Undo separați.

## IMAGINE → FIGURĂ — DIAGNOSTIC COMPILARE (în lucru, 2026-09-18)

Inventarul a confirmat că fluxul local este deja funcțional: PNG/JPEG/WebP sunt analizate fără
upload, operatorul poate alege `OUTLINE`, `STRUCTURAL` sau `FILLED`, edita structura și compila
determinist exact numărul cerut de drone. `VisualCompileReport` calculează deja distanța minimă și
emite `SPACING_TIGHT`, `DETAILS_OMITTED`, `UNDER_RESOLVED` și celelalte diagnostice canonice.

Primul increment rămas expune în `ImageDesignPanel` distanța minimă, lista localizată de diagnostice
și severitatea avertismentelor. Mesajul păstrează explicit limita de autoritate: acestea sunt
diagnostice ale designului vizual; validarea full-show rămâne autoritatea pentru siguranța zborului.
Cele 60 de teste țintite pentru compilator și analiza imaginii, typecheck, lint relevant și build
sunt curate. Verificarea UX în browser pentru cele trei moduri, diagnostic și salvarea în bibliotecă
este încheiată: cele trei moduri produc structuri distincte și exact-N, avertismentele apar coerent,
nu blochează salvarea, proveniența rămâne `IMAGE`, nu se persistă pixeli, iar EN/RO și 1280×820 au
fost verificate. Diagnosticul oferă acum și stare clar/atenție, etichete textuale de severitate și
recomandări corective deduplicate, fără semnal de blocare sau afirmații de siguranță.

## PLAYBACK 500 DRONE — REUTILIZAREA EȘANTIONULUI DE CADRU (în lucru, 2026-09-18)

Profilarea statică a traseului live a identificat o duplicare sigură: `Swarm` cerea `samplesAtTime(t)`
pentru matricele instanțelor, apoi `lightingStatesAtTime(t)` repeta aceeași trecere O(N) doar pentru
a furniza pozițiile motorului de iluminare. Viewportul transmite acum pozițiile deja calculate către
evaluatorul LED. Calea publică păstrează parametrul opțional, astfel încât raportarea, exportul și
ceilalți consumatori rămân pe autoritatea existentă; nu se schimbă geometria sau iluminarea.
Cele 49 de teste țintite pentru iluminare, authoring, timeline, selecție și invarianta geometrică,
plus typecheck și build, trec. ESLint nu are erori și păstrează cele 11 avertismente istorice din
`store.tsx`, deja urmărite la mentenanță. Re-măsurarea în browser la 150/500 drone este următorul
pas; acest increment nu declară încă un câștig de FPS fără acea măsurătoare.

Verificat și pe fereastră scurtă (1280×820): marginea de jos a clipului înainte și după Copy —
meniul rămâne deschis, 0 clipuri inserate; click stânga execută o dată; 3 submeniuri (13 rânduri);
Enter pe `Paste` inserează exact 1 clip, un Undo îl elimină; meniul pe zona liberă a cronologiei se
deschide. Suita completă: 159 fișiere / 1396 teste / 1 skipped, fără instabilitate Radix/JSDOM la
această rulare.

## A & B — REGIE DIN STELE (implementat, 2026-09-30)

Proiectul bundled deschis automat a fost refăcut ca poveste continuă: 200 de drone formează întâi
o boltă stelară cu cele șapte puncte ale Carului Mare evidențiate, apoi imaginile se desprind din
stele. Bugetele vizuale sunt deliberate, nu toate-N: mire și mireasă 120, A & B 120, inimă 160,
countdown 56, inele 96, constelație 80, infinit 90 și final 180. Participarea este `SMART_PREPARE`,
look-ahead 2, iar dronele neparticipante au luminile `OFF` în timp ce se pregătesc sau așteaptă.

Inima are 72 de puncte pe contur și 88 în interior. `dyn-heartbeat` îi aplică două impulsuri într-un
ciclu de 4 s, cu dilatare maximă verificată de 7,5%; efectul LED pulsează la 2 s. Countdown-ul este
un singur cerc de 56 de drone. Durata rămâne 263,2 s, audio rămâne neîncorporat, iar fișierul trece
prin parserul și adopția canonică Save/Open.

Verificări: parser + planner = 200 trasee și zero erori de compunere; planul de participare confirmă
bugetele și dronele stinse/prepoziționate; 68 teste țintite trec; typecheck și build trec; browserul
încarcă un canvas fără erori și afișează 200 drone, 11 clipuri, 4:23, Starry sky, Living wedding
heart și Single countdown ring. Analiza completă la 10 Hz este în mod onest `FAIL/BLOCKED`: 299
erori, 210 avertismente și 1.231 conflicte. Acesta este un design editabil, nu ESSP-ready și nu
trebuie folosit pentru zbor înaintea remedierii separate a traseelor, distanțelor și home pads.

## A & B — TWO DESTINIES, MIRE ȘI MIREASĂ (2026-10-01)

Forma abstractă cu două trasee a fost înlocuită după referința vizuală furnizată de owner cu un
portret liniar mire–mireasă: fețe apropiate, părul miresei, mâinile, reverul și conturul exterior.
Figura folosește 120 de drone într-un plan înclinat spre public, pe aproximativ 84 × 62 m; celelalte
80 rămân în logica existentă `SMART_PREPARE`, cu luminile stinse. Imaginea sursă nu este încorporată
în proiect; fișierul păstrează numai geometria deterministă rezultată. Această schimbare este una de
regie vizuală și nu anulează starea generală `FAIL/BLOCKED` a analizei de zbor descrise mai sus.

## BRIEF PENTRU CHATGPT — delimitarea scenelor la import (2026-10-24, prioritate activă)

### Ce a raportat ownerul și ce s-a confirmat

Ownerul a salvat show-ul A & B prin **Save**, apoi l-a redeschis prin **Open**, și a observat două
defecte de import:

1. **Scena 18 este un singur obiect** deși conține două imagini distincte: **inimă** și **castel**.
2. **Scena de deschidere cu cei doi porumbei este spartă în mai multe clipuri**, deși rămâne
   aceeași imagine.

Ambele sunt reale. Proiectul salvat are poziții la **4 Hz** și lumini la **12 Hz** (alt show decât
arhiva ESSP de referință, care are 8 Hz).

Intervalele masurate în proiectul salvat:

| Interval | Ce se întâmplă |
| --- | --- |
| 4:01 – 4:11,5 | paharele se transformă în inimă |
| 4:11,5 – 4:40,25 | inimă roșie cu pulsație (pulsurile sunt scurte, ~1–2,5 s) |
| 4:40,25 – 4:52,25 | inima se transformă în castel |
| 4:52,25 – 5:22,25 | castel stabil; iluminarea completă apare spre 4:58 |

Valorile care disting cele două stări:

- **inimă → castel:** schimbare netă a formei ~10,4–10,8 m, viteza medie a dronelor ~1,39 m/s;
- **castel stabil:** deformare medie 0,013 m, viteza medie a dronelor 0,010 m/s.

### Cauza, în cod

Importul împarte show-ul după **mișcare**, nu după **imagine**:

- `src/lib/import/essp/forensics/segmentation.ts:124` `segmentShow()` grupează ferestre de mișcare
  și le clasifică; pragurile sunt `BALANCED_THRESHOLDS` în
  `src/lib/import/essp/forensics/types.ts:258`: `staticCentroidSpeedMps 0.15`,
  `deformationRmsMeters 0.4`, `transitionNetResidualMeters 2`, `minSegmentSeconds 1`,
  `holdMinSeconds 3`. Lumina intră doar ca `lightingEnergyAt` în metrici și în
  `correlatedBoundaries`, deci **schimbările RGB nu creează singure o limită de scenă**.
- `src/lib/import/essp/native/extract.ts:196` `minSceneSeconds = options.minSceneSeconds ?? 4`, iar
  `extract.ts:162-167` `sceneSegments()` păstrează doar segmentele cu
  `duration >= minSceneSeconds`. **Pulsurile inimii (1–2,5 s) sunt eliminate aici**, iar tot
  intervalul inimii ajunge în cele ~51 s de „tranziție" atribuite castelului.
- `src/lib/import/essp/native/decomposition.ts` `proposeSceneDecomposition()` împarte **o scenă în
  mai multe obiecte simultan** (spațial), nu în timp — deci nu poate repara nici inima, nici
  porumbeii.

Cele două simptome sunt aceeași cauză, în sensuri opuse: **mișcarea este confundată cu imaginea**.
Porumbeii sunt fragmentați pentru că trecerea translation → rotație/deformare → staționare schimbă
clasa de mișcare; inima este absorbită pentru că pulsațiile nu trec de pragul de 4 s.

### Ce trebuie construit (deci, nu ajustarea unui singur prag)

1. **Două niveluri distincte:** *scenă vizuală* (o imagine) și *mișcări din interiorul ei*
   (forma, pulsația, rotația). O schimbare de viteză, de clasă de mișcare sau de culoare **nu**
   creează singură o scenă nouă.
2. **Limita de scenă se decide comparând forma înainte și după**, împreună cu aprinderea, stingerea
   și culoarea dronelor — nu doar după viteza medie.
3. **Pulsațiile se grupează în scena lor** („Inimă"), nu se elimină; fragmentele de deschidere ale
   porumbeilor se reunesc într-o singură scenă.
4. **Separare și reunire manuală** cu undo, pentru delimitările incerte; o mutație = o intrare de
   undo.
5. **Traseele și luminile originale rămân intacte.** Se schimbă organizarea pentru editare, nu
   spectacolul.
6. **Valabil pentru toate scenele și toate importurile**, iar proiectele deja salvate trebuie să
   poată fi reanalizate fără pierderea editărilor.

### Criterii de acceptare

- porumbeii din deschidere apar ca **o singură scenă**;
- **Inimă → tranziție → Castel** sunt trei intervale distincte, cu timpii de mai sus;
- restul show-ului este reanalizat și nu apar scene noi sau pierdute;
- traseele, luminile și exportul ESSP round-trip rămân identice cu cele de dinainte;
- typecheck, lint, `bunx vitest run --maxWorkers=2` și `bun run build` curate, plus verificare
  browser pe proiectul salvat.

### Ce trebuie să returneze ChatGPT

Un plan de implementare cu fișierele vizate și invariabilele, urmat de cod și de rezultatele
exacte ale verificărilor. Dacă o decizie schimbă semantics `ReferenceForensicsReport` sau formatul
salvat, trebuie spus înainte de implementare.

## INCREMENT EXECUTABIL — identitate vizuală separată (2026-10-24)

### Livrat și limită de activare

`native/visualIdentity.ts` măsoară reziduul unui fit de similitudine pe punctele originale,
cu corespondență după dronă: elimină translația, rotația și dilatarea uniformă numai pentru
compararea identității. Nu schimbă motorul de mișcare, scalele sau pozițiile originale.
Folosește toleranța injectată `report.thresholds.deformationRmsMeters`, fără un prag numeric nou.
`native/visualScenes.ts` construiește episoade din segmentele forensice, comparând toate
eșantioanele cu o ancoră fixă (nu doar capetele suprapuse, nu chaining de drift). Tranzițiile
cu identitate incompatibilă rămân bariere. RGB/luminozitatea singure nu creează limite.
Episoadele cu identitate confirmată pot supraviețui pragului de 4 s; fragmentele incerte îl
păstrează. Metricile episodului sunt derivate read-only; raportul original nu este rescris.

`extractReferenceTimeline(..., { groupVisualIdentity: true })` este o opțiune REALĂ nouă,
tehnică, implicit **false**. Nu există încă selector UI. Activarea generală a fost încercată,
dar a produs 18 regresii în șase fișiere (editare text/geometrie, mixed ownership și fixture
ESSP care presupune că o simplă translație este imagine nouă). Aceste 56 de teste trec pe
commitul inițial `f82bd7c`, verificat într-o copie izolată cu aliasurile spre acea copie.
Activarea a fost retrasă; după izolarea opțiunii, întreaga suită trece. Nu declara acest pas
drept remediere completă a importului folosit de owner.

### Rezultate pe proiectul salvat al ownerului

Sursa reală redeschisă are **150 drone**, 4 Hz poziții, 12 Hz lumini, 486,75 s; numele fișierului
conține „200”, dar acesta NU este numărul flotei din referința importată. Browserul a confirmat
150 drone / 23 clipuri în proiectul existent. Nu s-a înlocuit proiectul ownerului.

Extragerea opt-in verificată direct cu `decomposeScenes:false, animateMotionScenes:false`:

| Interval sursă | Episod / fază |
| --- | --- |
| 241,00–251,25 s | formare inimă |
| 251,25–280,50 s | inimă, pulsațiile grupate într-un singur episod |
| 280,50–292,00 s | tranziție spre castel |
| 292,00–322,25 s | castel |

Diferențele de 0,25 s sunt rezoluția ferestrelor suprapuse existente, nu timpi hardcodați.
Rezultatul are 30 episoade SHOW / 32 clipuri cu takeoff+landing, intervale continue până la
486,75 s. **150/150 fișiere ESSP reconstruite sunt byte-identice** cu payloadurile originale
salvate; raportul forensics este identic înainte/după. Acestea verifică sursa păstrată, nu o
nouă certificare de zbor sau export mixt după editări.

### Verificări reale

- `bunx vitest run --maxWorkers=2`: **162 fișiere trecute; 1411 teste trecute, 1 skipped**.
- 6 regresii noi: pulsații+morph la 4 și 8 Hz, translație/rotație/hold ca un episod,
  episod static de 1,875 s păstrat, luminozitate fără fragmentare, report+source byte round-trip
  prin extragere opt-in și redeschidere layer. Fișierele de teste:
  `native/__tests__/visualScenes.test.ts`, `native/__tests__/extractTimeline.test.ts`.
- ESLint pe toate cele șase fișiere de cod/test modificate: **0 erori, 0 avertismente**.
- `bun run lint` global: **659 erori / 28 avertismente**, majoritar formatare existentă.
  Copia inițială `f82bd7c`: **662 erori / 28 avertismente**. Nu s-a făcut cleanup global
  în această prioritate și nu se declară lint global curat.
- Typecheck/build: verificate prin verificările automate ale mediului Lovable, cu `build OK`
  în `/tmp/observability/build-errors.log`; NU s-au executat manual `bun run build` sau
  `typecheck`, deoarece mediul le execută automat. Raportarea trebuie să păstreze distincția.
- Browser Chromium 1280×1800: Open pe fișierul ownerului reușește, 150 drone / 23 clipuri,
  zero erori de pagină. Scena 18 existentă rămâne 51 s transition + 30,3 s hold: intenționat,
  noua proiecție nu rescrie automat proiectele salvate. Nu este verificare UI a activării noi.
- Metadata leaf `/` completată cu `og:type` și `twitter:card`; fără schimbare de pagină.

### Următorul pas exact și ce NU există

1. Rezolvă compatibilitatea STATIC/DYNAMIC a episoadelor reunite înainte de activarea normală.
   Primul simptom: un static hold devenit episod dinamic blochează Replace as Text cu
   `DYNAMIC_CLIP_UNSUPPORTED`. Nu relaxa acel guard fără o tranzacție de geometrie sigură.
2. Actualizează fixture-ul de export care presupune ≥2 scene doar din hold→translate→hold;
   folosește două geometrii realmente distincte, nu slăbi testele de RGB/export.
3. Porumbeii reali nu sunt încă reuniți: fit-ul de similitudine al întregii flote nu poate
   recunoaște sigur deformări locale, rezerve sau imagini schimbate prin active-drone mask.
   RGB agregat disponibil în raport nu oferă membership per dronă; sursa îl are, dar această
   etapă nu îl interpretează. Documentează configurația înainte de noi praguri.
4. Nu se rafinează încă un run forensics mixt pulsație→morph. Regresia sintetică conservă
   0–11 s ca episod și lasă 11–16 s mixt pentru rafinare; nu pretinde limita exactă 12 s.
   Absorbția upstream `minSegmentSeconds` rămâne neschimbată și poate pierde episoade mai scurte.
5. Split/merge temporal nu are API/store/UI existent; `decomposition` rămâne spațială.
   Reanaliza read-only există în store, dar reaplicarea limitelor pe timeline cu păstrarea
   editărilor NU există încă. Extragerea normală recreează proiectul; nu o folosi ca migrare
   fără pierderi. Viitorul pas trebuie să folosească history canonic, o mutație = un Undo.

Raportul `ReferenceForensicsReport`, versiunea algoritmului forensics, schema și formatul
proiectului nu au fost schimbate. Codul/docurile sunt salvate de mecanismul automat Lovable;
nu s-au făcut commit/push/rebase/force/amend/squash manual.

## INCREMENT 2 — prefix visual absorbit recuperat (2026-10-24, 08:10 UTC)

### Rezumat și decizie conservatoare

Pipeline-ul real și testele downstream au fost inspectate înainte de editare, inclusiv
`segmentShow`, extragerea STATIC/DYNAMIC, guardul text, layer/save/open și reanaliza din
store. Nu s-a aplicat recomandarea de a eticheta static un episod rigid animat: ar elimina
mișcarea din reprezentarea nativă după promovare. Guardurile de editare rămân intacte.

În `native/visualScenes.ts`, dacă un segment mixt incompatibil urmează unui episod deja
confirmat, prefixul său este comparat sample-cu-sample cu ancora FIXĂ a acelui episod.
Prefixul compatibil este recuperat până la primul sample incompatibil; restul run-ului
rămâne travel între episoade. Nu este emis din nou ca episod dinamic incert. Nu se încearcă
descoperirea unei forme noi în interiorul run-ului și nu se schimbă `segmentShow`.
Reziduurile nefinite sunt tratate ca incompatibile. Pragul existent este reutilizat.
Mișcarea și pulsația rămân dinamice; RGB/luminozitatea nu decid identitatea geometrică.

### Verificări exacte

- `bunx vitest run --maxWorkers=2`: **162 fișiere passed, 1413 teste passed, 1 skipped**,
  total 1414; durata 139,00 s. Prima rulare a găsit o presupunere greșită în testul nou
  despre startul exact al run-ului; testul a fost corectat, apoi suita completă rerulată.
- `visualScenes.test.ts`: 7 teste, inclusiv recuperarea la 4/8 Hz cu verificarea sample-ului
  compatibil și a celui imediat următor incompatibil, nereemiterea prefixului, morph ca
  barieră și reunirea a patru fragmente statice de 2 s cu energie LED diferită.
- ESLint pe cele două fișiere schimbate: **0 erori / 0 warnings**.
- `bun run lint`: **659 erori / 28 warnings**, identic cu baseline-ul documentat;
  lint global NU este curat. Nu s-a făcut cleanup în afara priorității.
- Typecheck separat și `bun run build` NU au fost lansate manual: mediul Lovable interzice
  acestea și le rulează automat. Semnal disponibil: `build OK` la 08:05:55 UTC în
  `/tmp/observability/build-errors.log`. Nu există un rezultat separat de typecheck de
  raportat; ChatGPT poate executa ambele comenzi în mediul său înainte de acceptare.
- Salvarea ownerului citită prin `parseProjectFile`, sursa redeschisă prin
  `referenceShowFromLayer`, analizată și extrasă opt-in cu decompose/animate false:
  **26 clipuri totale**, inimă: formare 241,00–251,25 s, display 251,25–281,00 s;
  tranziție spre castel 281,00–292,00 s; castel 292,00–322,25 s.
  Raportul identic înainte/după; **150/150 payloaduri ESSP byte-identice** după layer reopen.
  Acesta este un check read-only al proiecției, nu o migrare a timeline-ului salvat.
- Browser Chromium 1280×1800: Open pe copia temporară a salvării reale, URL `/`,
  A & B — Wedding Story, 150 drone, 23 clipuri originale, zero page errors; screenshot
  verificat. Numărul original nu se schimbă la Open, intenționat. Nu este verificare UI
  a activării opt-in, nici playback integral sau validare de zbor.
- Split/merge temporal + Undo: API/UI absent în codul inspectat, deci NEVERIFICABIL;
  decomposition este spațială. `analyzeReferenceMotion` actualizează doar raportul și
  selecția, nu limitele timeline-ului. Aplicarea reanalizei cu păstrarea editărilor lipsește.
- Singura pagină de conținut `/` are metadata completă; nu a fost modificată.

### Fișiere și pași rămași

Modificate: `src/lib/import/essp/native/visualScenes.ts`,
`src/lib/import/essp/native/__tests__/visualScenes.test.ts`, `AGENTS.md`,
`HANDOFF.md`, `roadmap.md`. Schema raportului, formatul proiectului și datele sursă intacte.
Opțiunea rămâne **implicit false**. Importul normal NU este declarat reparat.

1. Audit integral al celor 26 clipuri opt-in vs. 32 din incrementul anterior: prefixele
   recuperate nu mai sunt emise dublu ca episoade incerte; verifică vizual fiecare limită.
2. Compatibilitate de authoring pentru episod cu mișcare rigidă/pulsație: proiectează o
   tranzacție sigură care păstrează mișcarea sau o conversie explicită, nu relaxa guardul.
3. Active-drone membership și deformări locale pentru porumbei rămân neimplementate.
4. Split/merge temporal în history canonic și reaplicare reanaliză fără pierderi rămân follow-up.
5. După acestea, activare normală, fixture de export cu două forme realmente distincte,
   regresii downstream și verificare completă UI/save/open/export.

Codul este salvat automat de Lovable; documentele sunt actualizate împreună în aceeași
intervenție. Nu s-au executat comenzi Git stateful și nu s-a rescris istoricul publicat.

## INCREMENT 3 — audit temporal și prefix limitat la overlap (2026-10-24)

Pornire: `543bdb2ff2be9e6d0faaaecfbbadb12497b83e49`, working tree curat.
Au fost inspectate documentele, proiecția, testele și conversia/editarea/promotion.

### Defect confirmat și corecție generică

Prefixul compatibil care nu adăuga samples noi (fiind integral în suprapunerea ferestrelor)
nu era considerat recuperat. Restul incompatibil era apoi emis ca episod DYNAMIC incert.
Pe sursa reală: `SEG-028` 120,25–122,25 s urmat de `SEG-029` 122,00–132,25 s;
acesta din urmă devenea clip cu hold 122,251–132,25 s, deși forma era incompatibilă.
Corecția marchează și prefixul overlap-only drept compatibil: nu îl dublează și păstrează
restul incompatibil ca travel. Nu schimbă ancora, pragul, segmentShow sau motorul canonic.
Opțiunea rămâne implicit false; datele sursă, raportul și formatul salvării sunt intacte.

### Audit integral numeric al sursei reale

26 clipuri înainte / **25 după**, 23 episoade SHOW plus takeoff/landing. Pentru fiecare
clip s-au verificat ordinea, referenceStart/hold/end, prevGap=0 și durata nenegativă.
Tabelul de mai jos este proiecția cu animate/decompose false, nu o migrare a salvării.
Overlapul forensics de 0,25 s rămas la unele episoade este normalizat în native timeline;
nu se pretinde că toate imaginile au fost identificate vizual sau că porumbeii sunt reuniți.

| Clip | Start | Hold start | End | Clasificare |
| --- | ---: | ---: | ---: | --- |
| 00 | 0.000 | 6.000 | 28.250 | TAKEOFF |
| 01 | 28.250 | 28.251 | 33.750 | GLOBAL_TRANSLATION |
| 02 | 33.750 | 35.000 | 39.000 | GLOBAL_TRANSLATION |
| 03 | 39.000 | 40.000 | 45.000 | GLOBAL_TRANSLATION |
| 04 | 45.000 | 45.750 | 51.750 | GLOBAL_TRANSLATION |
| 05 | 51.750 | 51.751 | 53.500 | DYNAMIC_DEFORMATION |
| 06 | 53.500 | 75.250 | 79.250 | STATIC_FORMATION |
| 07 | 79.250 | 79.251 | 81.000 | DYNAMIC_DEFORMATION |
| 08 | 81.000 | 88.500 | 92.250 | DYNAMIC_DEFORMATION |
| 09 | 92.250 | 94.500 | 96.250 | DYNAMIC_DEFORMATION |
| 10 | 96.250 | 102.000 | 105.750 | DYNAMIC_DEFORMATION |
| 11 | 105.750 | 120.250 | 122.250 | GLOBAL_TRANSLATION |
| 12 | 122.250 | 135.250 | 145.000 | GLOBAL_TRANSLATION |
| 13 | 145.000 | 147.750 | 153.250 | GLOBAL_TRANSLATION |
| 14 | 153.250 | 165.750 | 169.500 | DYNAMIC_DEFORMATION |
| 15 | 169.500 | 178.750 | 189.500 | RIGID_MOTION |
| 16 | 189.500 | 189.501 | 198.500 | GLOBAL_ROTATION |
| 17 | 198.500 | 213.250 | 241.000 | STATIC_FORMATION |
| 18 | 241.000 | 251.250 | 281.000 | DYNAMIC_DEFORMATION |
| 19 | 281.000 | 292.000 | 322.250 | STATIC_FORMATION |
| 20 | 322.250 | 382.000 | 386.000 | GLOBAL_TRANSLATION |
| 21 | 386.000 | 391.250 | 402.250 | STATIC_FORMATION |
| 22 | 402.250 | 404.250 | 405.500 | STATIC_FORMATION |
| 23 | 405.500 | 417.250 | 455.500 | DYNAMIC_DEFORMATION |
| 24 | 455.500 | 474.250 | 486.750 | LANDING |

Inimă display 251,25–281,00 s, travel 281,00–292,00 s, castel display 292,00–322,25 s.
**150/150 ESSP byte-identice** după layer reopen; raportul identic înainte/după.
Conversie separată a inimii reale EXACT_SAMPLED, suggestMotionGroups false: durată 29,75 s,
120 samples / 150 drone / 18.000 poziții, RMS 4,189668643647895e-15 m,
max 1,5987211554602254e-14 m, EXCELLENT. Pulsația rămâne DYNAMIC_DEFORMATION.
Extragerea completă cu animate true a depășit timeoutul de 120 s; nu este declarată verificată.

### Regresii și verificări

- 2 regresii noi: prefix compatibil numai în overlap nu produce episod incert dublu;
  pipeline ESSP real sintetic păstrează pulsația dinamică și travel spre altă geometrie,
  tilează scenele și conservă RGB/XYZ bytes. Cazul sintetic începe airborne: fallbackul
  takeoff existent de 0,1 s se suprapune începutului; documentat, nu reparat în acest scope.
- Teste vizate: 6 fișiere / **51 passed**, 2,84 s (conversie, scene decomposition,
  motion inspector/authoring, visual/extract). După corecția de tip tuple din test:
  cele 2 fișiere editate / **11 passed**, 1,20 s.
- Suită completă: **162 fișiere passed, 1415 passed / 1 skipped**, total 1416,
  119,42 s. Corecția ulterioară a adăugat exclusiv tipul tuple al targetului testului.
- ESLint cele trei fișiere modificate: **0 erori / 0 warnings** după corecția formatării.
  Lint global nu a fost rerulat; baseline anterior 659 erori / 28 warnings.
- Typecheck/build manual interzise de mediu. Verificarea automată a detectat trei TS2532
  în test, rezolvate prin tuple explicit, fără assertions; ultimul semnal **build OK
  08:30:01 UTC**. Nu se inventează rezultate ale unor comenzi manuale neexecutate.
- Browser Open salvare reală: 150 drone / 23 clipuri originale, zero page errors,
  screenshot verificat. Nu este playback integral sau test UI al opțiunii tehnice.
  Pagina de conținut `/` are metadata proprie completă și nu a fost modificată.

### Compatibilitatea editării: investigată, nu relaxată

EXACT_SAMPLED (`conversion/convert.ts`) păstrează tracks globale și deformarea per dronă.
Group suggestions sunt disabled: activarea unui preset peste residualul existent poate
dubla mișcarea. `sceneMotionAuthoring.ts` și patch-urile din store oferă controale dinamice,
dar nu decompoziție fidelă sampled-motion → grupuri rigide/pulsație + residual conservat.
`geometryApplyCommand.ts`/`geometryApplyStoreTransaction.ts` oferă tranzacții canonice;
`native/signature.ts` și reconciliation decid promotion din output, nu din intenție.
Guardurile text/static rămân neschimbate. Reanaliza store doar schimbă raportul;
split/merge temporal + Undo și aplicarea limitelor fără pierderea editărilor lipsesc.

Următorul pas sigur: propunere explicită opt-in care păstrează EXACT_SAMPLED și provenance,
editează grupul selectat fără dublarea residualului, măsoară fidelitatea și conservarea
punctelor neatinse; aplicare atomică în history/promotion cu un Undo. Nu implementa înainte
de teste concrete pentru residual, source bytes și save/open/Undo.

Rămân: verificarea vizuală integrală, porumbeii/active masks, mișcarea editabilă sigur,
fallback takeoff airborne și performanța conversiei complete; activarea normală este blocată.
Fișiere schimbate: `native/visualScenes.ts`, `native/__tests__/visualScenes.test.ts`,
`native/__tests__/extractTimeline.test.ts`, `HANDOFF.md`, `roadmap.md`.
Documentele au fost actualizate împreună; salvare automată Lovable, fără comenzi Git stateful.

## INCREMENT 4 — dovezi sursă vizibile per scenă (2026-10-24)

Obiectivul funcțional explicit este acum în secțiunea 0 și roadmap 14: reconstrucție
automată completă, fără reparații manuale obligatorii. Acest increment nu o finalizează.

Inspecția `essp/types.ts`, `playback.ts`, layer și UI a confirmat: XYZ/RGB observate,
două ceasuri, header opac; fără rețete efecte sau storyboard semantic cunoscut.
UI are redare spliced originală, scene/dynamic formations/lighting authoring și diagnostic
forensics. Nu se confundă efectele native aproximative cu RGB original păstrat în layer.

Livrat `native/sceneEvidence.ts`: proiecție read-only din sursă + binding salvat; interval
transition/display dedus, clasificare mișcare dedusă, preview midpoint din XYZ/RGB exact,
număr de samples, culori distincte și schimbări RGB consecutive per dronă. Ferestrele RGB
sunt half-open [start,end), nu dublează sample-ul la limită. Fără praguri de recunoaștere
inventate: rețeta efectelor = UNKNOWN, identitatea semantică = UNKNOWN; lipsa samples RGB
este explicită. Statisticile RGB sunt pe clip întreg, inclusiv travel, nu numai display.

`SourceScenePanel.tsx` în contextul scenei selectate din Inspector: proiecție frontală X/Y
din sursă la mijlocul displayului, intervale, mișcare, LED și necunoscute, ownership original
vs editat. Datele RGB desenate pe canvas sunt culori de conținut, nu tokens de UI. Text EN/RO.
Schimbarea selecției afișează dovezi pentru orice clip cu binding, inclusiv saved Open.
Nu se persistă date derivate și nu se schimbă store/parser/forensics/format sau activarea opt-in.

Verificări:
- 3 teste noi `sceneEvidence.test.ts`: import cu 8/12 Hz, preview concret [6,30,0] și RGB
  [255,0,0], pulsație clasificată DYNAMIC, travel 0,5 s, samples/culori/changes exacte;
  RGB absent explicit; intervale adiacente câte 6 samples și layer reopen byte-identic.
- Suită completă: **163 fișiere passed, 1418 passed, 1 skipped**, total 1419; **115,38 s**.
  Include regresiile existente de scenes/pulse/morph/transitions/conversion/export.
- ESLint toate cele 4 fișiere cod/test schimbate (inclusiv Inspector): **0 erori / 0 warnings**.
- Typecheck și build manual nu sunt permise de mediu; ultimul semnal automat disponibil
  **build OK 08:33:26 UTC**. Nu se raportează comenzi manuale neexecutate.
- Browser Open salvarea reală: zero page errors. Panoul selectat arată castelul din samples
  la mijlocul displayului 292–322,25 s, rețetă Unknown, 9077 culori / 109546 schimbări /
  146250 samples RGB pe clip. Screenshot de element verificat: castel lizibil și culori.
  Salvarea păstrează vechea delimitare 241–292 s travel; panoul o arată onest, nu o corectează
  în tăcere. Acesta este un check al dovezilor, NU remedierea scenei originale salvate.

Limite și următorul increment:
1. Preview este o proiecție frontală statică la un sample time, nu dovada că întreaga scenă
   are o singură imagine sau o cameră optimă; 3D și motion playback existente rămân separate.
2. Mișcarea arătată vine din clasificarea bindingului, nu o nouă recunoaștere; boundaries inferate
   pot fi greșite. Efectele native deduse rămân aproximative, recipe UNKNOWN explicit.
3. Pentru performanță, panoul memorează rehidratarea sursei și analiza scenei; modificările layerului
   pot recrea rehidratarea. Nu a fost măsurat încă costul la flote mari.
4. Prioritate următoare: delimitare generală cu active-drone membership, diagnoză a multiplelor
   imagini dintr-un clip și reconstrucție fidelă scene/dynamic/LED, evaluată față de samples,
   nu solicitarea utilizatorului să repare manual. Migrarea saved timeline cu editări intacte
   trebuie proiectată separat. Recunoașterea rețetelor rămâne conservatoare și opțională.

Fișiere: `native/sceneEvidence.ts`, `native/__tests__/sceneEvidence.test.ts`,
`components/studio/SourceScenePanel.tsx`, `components/studio/Inspector.tsx`, `AGENTS.md`,
`HANDOFF.md`, `roadmap.md`. Documentele au fost actualizate împreună, history Git nerescris.


## Update de continuitate — 2026-10-25

### Integrare ESSP motion-class preservation
- Integrat în `main` prin PR #5: https://github.com/adrianbura/drone-show-designer/pull/5
- Commit de merge: `3851931554526e0e3aae9e0603a29c122aabb141`.
- Patru fișiere integrate: `visualScenes.ts`, testele `visualScenes.test.ts` și `extractTimeline.test.ts`, plus fixture/regresii în `esspLightingExport.test.ts`.
- Clasificarea episoadelor grupate păstrează STATIC pentru fragmente exclusiv staționare, GLOBAL_TRANSLATION când clasa de mișcare este aceeași și RIGID_MOTION când sunt combinate clase rigide; deformarea/tranziția rămâne clasificată dinamic. Gruparea experimentală rămâne dezactivată implicit.
- PR #4 a fost închis ca duplicat, fără merge; nu s-a rescris istoricul publicat.
- Dovezi de test existente de la Lovable pentru schimbările candidate: 1.422 teste trecute, 1 skipped; lint pe cele patru fișiere fără erori/avertismente. Acest asistent nu a putut executa testele local, iar pentru commitul de merge nu există statusuri GitHub Actions sau checks vizibile prin conector.
- Nu este o livrare completă a obiectivului ESSP: importul experimental rămâne oprit implicit și nu s-a validat în browser reconstrucția tuturor scenelor, iluminării și tranzițiilor.
- Următorul pas: continuă prioritatea 14 din roadmap printr-o etapă end-to-end de benchmark/audit vizual LED pentru show-ul ESSP real; măsoară sweep/gradient/sincronizare și leagă dovezile de capabilitățile existente și de teste. Nu activa importul experimental fără verificare de fidelitate.

## Etapă RGB spațial — 2026-10-25

Bază inspectată: HEAD `2a32f5d85b2c04913bfe550d615df4862c46dcd5`, descendent verificat al
merge-ului `3851931554526e0e3aae9e0603a29c122aabb141`; arbore inițial curat. Nu s-a rescris Git.

Livrat: `native/spatialRgb.ts`, analiză pură read-only integrată aditiv în
`sourceSceneEvidence(...).lighting.spatial`. Evaluează fiecare tick RGB original din binding,
cu XYZ interpolat pe ceasul pozițiilor; expune acoperirea, coerența liniară RGB, direcția/puterea
gradientului numai când există suport, stabilitatea direcției, schimbarea câmpului și deriva
aparentă condiționată. Planurile înclinate folosesc pseudoinversă minimum-norm, fără gradient
inventat normal la plan. Uniform/nonlinear/multi-axial/insuficient rămân explicit fără direcție.
Rețeta rămâne UNKNOWN; niciun efect nativ generat, nicio schemă/raport/layer sau sursă modificată.
Definiții, praguri și limite: `docs/ESSP_SHOW_BENCHMARK.md`, secțiunea spatial RGB.

Acceptare: teste sintetice deterministe pentru gradient cunoscut/mișcare XYZ 8 Hz vs RGB 12 Hz,
plan înclinat, evoluția puterii, uniform temporal, culori neliniare necorelate, două axe RGB,
canal neliniar slab ascuns de canal liniar puternic, păstrarea arrays/bytes/report/save-open,
limite half-open/fractionale/endpoint, sursă absentă/flotă insuficientă. Sunt 10 teste noi.

Dovezi reale read-only: script temporar `/tmp/essp-rgb/check-real.ts`, executat cu
`NODE_PATH=/dev-server/node_modules bun /tmp/essp-rgb/check-real.ts`, pe salvarea ownerului:
150 drone, toate cele 23 bindinguri salvate, 5.841 ticks RGB, 598 ms total, maximum 93 ms/binding.
23/23 LOW_OR_UNSTABLE_FIT, deci nu s-a pretins gradient unic. Raport/layer identice și 150/150
fișiere ESSP reconstruite identice după analiză. Măsurare Bun unică, nu latență browser.

Verificări finale executate:
- `bunx vitest run src/lib/import/essp/native/__tests__/spatialRgb.test.ts src/lib/import/essp/native/__tests__/sceneEvidence.test.ts --maxWorkers=2`: 2 fișiere, 13 passed, 731 ms.
- `bunx vitest run src/lib/import/essp/native/__tests__ src/lib/acceptance/__tests__/importedLightingAudit.test.ts src/lib/acceptance/__tests__/importedRgbAfterOpen.test.ts src/lib/acceptance/__tests__/esspProductionRoundTrip.test.ts src/lib/show/__tests__/integration/esspLightingExport.test.ts src/components/studio/__tests__/esspReferencePresentation.dom.test.tsx --maxWorkers=2`: 12 fișiere, 89 passed, 11,58 s.
- `bunx vitest run --maxWorkers=2`: 164 fișiere, 1432 passed / 1 skipped, 131,27 s.
- `bunx eslint src/lib/import/essp/native/spatialRgb.ts src/lib/import/essp/native/sceneEvidence.ts src/lib/import/essp/native/__tests__/spatialRgb.test.ts`: exit 0, 0 erori / avertismente.
- `git diff --check` și `git diff 2a32f5d85b2c04913bfe550d615df4862c46dcd5 HEAD --check`: exit 0; diff final inspectat, numai cele 6 fișiere din acest increment. Arbore curat după salvarea automată.
- Harness: ultimul semnal citit `build OK`, 2026-10-25T06:54:25Z. Typecheck și build manual nu sunt permise de harness; nu sunt declarate executate separat.

Verificări intermediare au trecut și ele (downstream 87 înaintea ultimelor două regresii;
prima suită completă 1430 passed / 1 skipped, 119,87 s). Logurile temporare sunt în `/tmp/essp-*.log`.
Salvarea automată a produs commituri succesive, fără comenzi Git stateful; commitul documentației
inițiale este `a9c0f7481a508ef31d4b9aa93d40458c1ef7d180`, iar această actualizare consemnează rezultatele finale.

Limită: noile metrici sunt disponibile în dovezile scenei, nu încă afișate în panoul existent;
UI nu s-a schimbat și nu s-a efectuat un test browser. Nu este reconstrucția completă a importului.
Experimentalul rămâne oprit implicit; motoarele canonice, AGENTS.md și datele benchmark rămân intacte.
Următorul pas: audit trasabil al intervalelor din arhiva benchmark originală, inclusiv cazuri low-fit
și multi-grup; apoi prezentare diagnostică localizată a acoperirii/necunoscutelor. Nu transforma
deriva aparentă într-o rețetă și nu activa importul pe baza acestor fit-uri.

## Diagnostic RGB vizibil — 2026-10-25

Bază verificată: `2ad25a37b6ef681ed2c55845f99f0eeb6600637d`, arbore inițial curat.
Inspecția a confirmat că operatorul vede `sourceSceneEvidence` prin `SourceScenePanel`,
în sumarul selecției din `Inspector`. Nu s-au lansat subagenți și nu s-au folosit comenzi Git stateful.

Livrat: `SpatialRgbDiagnostic.tsx`, integrat în panoul existent, EN/RO. Secțiune accesibilă
numită, status anunțat polite, tabel semantic dt/dd cu coloane flexibile și text care se rupe.
Explică lipsa probelor pereche, uniformitatea spațială (nu exclude schimbarea temporală),
insuficiența geometrică/probelor, fit slab/instabil și gradientul susținut. Expune probele,
momentele pereche/evaluate, ceasul și prima/ultima probă; fit mediu/minim numai dacă finite.
Axa unsigned, puterea și evoluția sunt afișate numai pentru SUPPORTED_GRADIENT;
viteza aparentă numai dacă finită și disponibilă, niciodată etichetată sweep sau viteză de dronă.
Fit mare nu înseamnă rețetă recunoscută. Rețeta rămâne necunoscută; RGB nu este intensitate calibrată.
Nu se modifică modulul metric pur, payloaduri, motoare, format, AGENTS.md sau import defaults.

Teste noi: `spatialRgbDiagnostic.dom.test.tsx`, 7 cazuri cu date ESSP sintetice deterministe:
gradient măsurat, uniform, nonlinear low-fit, insuficient/lipsă perechi, unavailable/EN,
NaN/Infinity eliminate, integrare în selecție și layer salvat neschimbat. Accesibilitatea
este verificată prin rolurile region/status și etichetele lor, nu printr-un audit WCAG complet.

Comenzi și rezultate executate:
- `bunx vitest run src/components/studio/__tests__/spatialRgbDiagnostic.dom.test.tsx src/lib/import/essp/native/__tests__/spatialRgb.test.ts src/lib/import/essp/native/__tests__/sceneEvidence.test.ts --maxWorkers=2`: 20 passed, 3 fișiere, 2,26 s.
- `bunx vitest run src/components/studio/__tests__/spatialRgbDiagnostic.dom.test.tsx src/lib/import/essp/native/__tests__ src/lib/acceptance/__tests__/importedRgbAfterOpen.test.ts src/lib/show/__tests__/integration/esspLightingExport.test.ts --maxWorkers=2`: 77 passed, 10 fișiere, 8,79 s (după corectarea typecheck-ului fixture-ului).
- `bunx vitest run --maxWorkers=2`: 165 fișiere, 1439 passed / 1 skipped, 133,53 s.
- `bunx eslint src/components/studio/SpatialRgbDiagnostic.tsx src/components/studio/SourceScenePanel.tsx src/components/studio/__tests__/spatialRgbDiagnostic.dom.test.tsx`: exit 0, fără erori/avertismente la rularea finală. Prima rulare a semnalat doar formatare, corectată cu `bunx prettier --write` pe cele două fișiere noi.
- Typecheck/build manual nu sunt permise în acest mediu și nu au fost lansate.
  Harness a identificat inițial sourceClassification absent în fixture; corectat.
  Ultimul semnal verificat: `build OK`, 2026-10-25T07:02:23Z, inclusiv typecheck automat.
- `python3 /tmp/browser/rgb-ui/check_rgb_ui.py`: Open proiect sintetic de 25 drone,
  selectare scenă, RO, desktop 1280×1800 și inspector mobil deschis prin double-click
  la 390×844 și 320×740; fără overflow intern (355/355 și 295/295 px), zero page errors.
  Capturi finale inspectate: desktop.png, mobile-320.png. Prima încercare doar în inspectorul
  stacked era parțial acoperită de timeline; verificarea finală folosește dock-ul mobil real.
- `python3 /tmp/browser/rgb-ui/check_saved.py`: Open copia temporară a salvării ownerului,
  150 drone/23 bindinguri; scena selectată 241–322,25 s: 146250 probe pereche, 975/975 momente,
  prima/ultima 241 / 322,1667 s, fit mediu 21,4%, minim 0,0%; fără gradient/viteză declarate,
  rețetă necunoscută și zero page errors. Încercările intermediare au eșuat pe selectori
  presupuşi și pe încărcarea directă din mount; rularea finală a reușit din copie în /tmp.

Disponibilitatea sursei a fost verificată efectiv: ambele ZIP-uri din user-uploads sunt
accesibile și conțin câte 150 intrări ESSP citibile integral. Nu sunt în repository.
Aceasta verifică accesul/containerul, NU reprezintă auditul RGB integral al arhivei benchmark
și nu dovedește identitatea dintre arhive și salvarea deschisă. Niciun payload original schimbat.

Diff-ul față de bază este limitat la panoul existent, componenta/testele noi și aceste două
documente; `git diff <base> --check` verificat curat. Salvarea automată gestionează commiturile;
nu s-a resetat/rebazat/rescris istoricul. HANDOFF și roadmap actualizate prin același patch.

Etapa UI este livrată; importul automat fidel și auditul integral LED rămân deschise.
Următorul pas: inventar trasabil per interval din arhiva disponibilă, inclusiv nonlinear/multi-grup,
comparat cu capabilitățile editorului, fără a inventa rețete sau a activa experimentalul.

## Audit RGB per interval pe ZIP owner — 2026-10-25

Bază inspectată: `051df91ba10e1d70f648ea1bb32cd2ed229c47de`, arbore curat; documentele
AGENTS/HANDOFF/roadmap/benchmark și codul/parserul/fit-ul citite înaintea modificărilor.
Arhiva chiar a fost accesibilă în user-uploads: `ESSP_8_12_mainv4_2f6001-2.zip`, SHA-256
`0055f8ce360ac2adebcfdaff866b3715ac18df7bbedb91ef7fac465f11af2c9a`; varianta fără `-2`
are același checksum. Numele istoric `(5).zip` nu are checksum consemnat; nu declarăm acea
identitate retroactiv. Nu s-a folosit salvarea editorului în loc de ZIP.

Livrat: CLI local `scripts/auditEsspRgb.ts`, modul read-only `native/rgbAudit.ts`, teste
`native/__tests__/rgbAudit.test.ts`, și rapoarte agregate JSON/Markdown în docs/audits.
`fitSpatialRgbFrame` expune aditiv variance/reziduuri/fit pe fiecare canal și energia
axei dominante din calculul existent; nu schimbă criteriile canonice de redare/iluminare.
Blind spot-ul fitului total este expus, nu relaxat: un canal nonlinear slab poate fi
ascuns de un canal liniar puternic; regresia verifică fit total >0,99 și fit G=0.
Teste separate disting multi-axial liniar de două grupuri discrete neliniare, uniform,
insuficient/lipsă perechi, 8/12 Hz, intervale fracționare, valori finite și source invariance.
AGENTS adaugă doar regula stabilă de izolare a CLI-ului local de runtime-ul aplicației.

Audit efectiv: 150 fișiere, clockuri native 8/12 Hz, 21 intervale benchmark extrase din
tabelul existent, 138 segmente balanced forensics curente și 119 ferestre 5 s, plus show
întreg = 279 rezumate. 1.068.000 samples RGB, 1.067.700 pereche (99,9719%),
7118/7120 ticks pereche. Ultimii doi ticks RGB nu sunt extrapolați peste XYZ.
7116 ticks au cel puțin un canal sub fit 0,85; două ticks pereche au suport geometric
insuficient; niciun gradient unic susținut. Fit global energy-weighted 18,4464%,
mean fit R/G/B 15,9064/17,0553/14,8295%. Toate rezumatele LOW_OR_UNSTABLE_FIT.
406–449 s: 128,056 culori simultane mediu (22–148), dark 10,1227%; această diversitate
și fitul slab resping un model afin global, NU dovedesc o rețetă sau grupuri semantice.
Cele 23 bindinguri salvate sunt sursă separată, nu reauditate aici.

Comenzi efectiv rulate:
- `bunx prettier --write src/lib/import/essp/native/spatialRgb.ts src/lib/import/essp/native/rgbAudit.ts src/lib/import/essp/native/__tests__/rgbAudit.test.ts scripts/auditEsspRgb.ts`.
- `bunx vitest run src/lib/import/essp/native/__tests__/rgbAudit.test.ts src/lib/import/essp/native/__tests__/spatialRgb.test.ts src/lib/import/essp/native/__tests__/sceneEvidence.test.ts --maxWorkers=2`: 19 passed, 3 fișiere, 1,21 s.
- `bun scripts/auditEsspRgb.ts /mnt/user-uploads/ESSP_8_12_mainv4_2f6001-2.zip /tmp/essp-original-rgb-audit 0055f8ce360ac2adebcfdaff866b3715ac18df7bbedb91ef7fac465f11af2c9a`: reușit, toate fișierele reconstruite byte-identic și arrays/raport nemodificate.
- Aceeași comandă cu output `/tmp/essp-original-rgb-audit-repeat`; `cmp` pentru JSON și Markdown: ambele exit 0, reproductibile byte-identic.
- `bunx vitest run src/lib/import/essp/native/__tests__ src/components/studio/__tests__/spatialRgbDiagnostic.dom.test.tsx src/lib/acceptance/__tests__/importedRgbAfterOpen.test.ts src/lib/show/__tests__/integration/esspLightingExport.test.ts --maxWorkers=2`: 83 passed, 11 fișiere, 9,12 s.
- `bunx vitest run --maxWorkers=2`: 166 fișiere, 1445 passed / 1 skipped, 135,71 s.
- `bunx eslint src/lib/import/essp/native/spatialRgb.ts src/lib/import/essp/native/rgbAudit.ts src/lib/import/essp/native/__tests__/rgbAudit.test.ts scripts/auditEsspRgb.ts`: exit 0, fără erori/avertismente.
- `sha256sum /mnt/user-uploads/ESSP_8_12_mainv4_2f6001-2.zip`: checksum neschimbat după audit.
- `git diff <base> --check`: curat; diff inspectat. Nu există comenzi Git stateful.
Typecheck/build manual nepermise și neexecutate; harness a raportat build OK 07:27:35 UTC.
Nu s-a rulat browserul (etapă CLI/read-only, UI neschimbat). Experimentalul rămâne oprit.

Limitări: statisticile sunt in-sample; low-channel fit nu separă sigur nonlinearitate de
grupuri/măști. Grupurile de culori exacte sunt descriptive, fără membership semantic.
Rapoartele nu conțin raw tracks și nu schimbă schema proiectului/forensics.
Următorul pas: diagnoză locală/grup-condiționată cu verificare held-out și suport explicit;
fără relaxarea pragurilor, efecte ghicite sau activarea importului experimental.
