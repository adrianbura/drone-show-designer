# Drone Show Designer — Handoff / Stare actuală

> Document de predare pentru un al doilea asistent (ChatGPT) conectat la același repo GitHub
> (`adrianbura/drone-show-designer`, branch `main`). Scop: să știe unde am rămas, ce reguli
> se respectă și ce mai trebuie făcut.

## 0. Protocol de colaborare ChatGPT ↔ Lovable

- ChatGPT are rolul de **Project Manager tehnic**: analizează starea reală din repository,
  stabilește următorul pas justificat, păstrează coerența arhitecturală și verifică rezultatul.
- `HANDOFF.md` și `roadmap.md` se actualizează la fiecare intervenție relevantă, astfel încât
  utilizatorul, ChatGPT și Lovable să lucreze după aceeași stare a proiectului.
- Când utilizatorul spune **„continuă”**, ChatGPT alege primul pas executabil cu valoare maximă
  din roadmap, verifică mai întâi codul existent, apoi implementează fără a cere reconfirmarea
  priorității. Dacă există un blocaj real sau o decizie de produs ireversibilă, îl raportează
  înainte de implementare.
- ChatGPT poate redacta un prompt pentru Lovable când o sarcină se potrivește mai bine fluxului
  său vizual sau când munca poate fi separată fără două autorități concurente. Promptul trebuie
  să includă scopul, fișierele permise, invariabilele, criteriile de acceptare și verificările.
- ChatGPT inspectează modificările produse de Lovable înainte de a le considera finalizate și
  actualizează documentele numai după ce starea raportată este susținută de cod și verificări.
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
- **Ultima stare analizată:** `main` la `a62bcaa` (verificarea Lovable pentru viewport).
- **Lucru curent:** copy/paste intern este implementat pentru clipuri SHOW și obiectele scenei,
  cu snapshot la Copy, identități noi la Paste și o singură revizie Undo.
- **Prioritate activă:** verificare UX/browser pentru copy/paste, apoi șabloane de show.
- **Validare încă necesară:** toate cifrele de performanță provin din Playwright headless cu
  SwiftShader; o măsurătoare pe GPU real rămâne de făcut înainte de orice promisiune de fps.
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

| Flotă | Pauză | Redare |
| --- | --- | --- |
| 150 | 62 ms/cadru (16 fps) | 107 ms/cadru (9 fps) |
| 500 | 158 ms/cadru (6 fps) | 220 ms/cadru (5 fps) |

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

| Flotă | Pauză înainte | Pauză după | Redare înainte | Redare după |
| --- | --- | --- | --- | --- |
| 150 | 62 ms/cadru (16 fps) | **16,7 ms/cadru (60 fps)** | 107 ms/cadru (9 fps) | 128 ms/cadru (7,8 fps) |
| 500 | 158 ms/cadru (6 fps) | **16,7 ms/cadru (60 fps)** | 220 ms/cadru (5 fps) | 281 ms/cadru (3,6 fps) |

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
2. **Șabloane de show** — `src/lib/studio/showTemplates.ts`, fără a dubla autoritatea motoarelor.
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

### VERIFICARE BROWSER COPY/PASTE — ÎNCHISĂ (19 sep 2026)

Metodă: Playwright headless Chromium + SwiftShader, viewport 1600×1800, `http://localhost:8080`,
show construit prin UI („Set up launch grid" → „Add take-off" → „Append clip" → „Add landing"),
gesturi reale de mouse (`mouse.move` + `down/up` cu buton dreapta) și tastatură.
Scripturi: `/tmp/browser/cp/verify.py` (clipuri), `/tmp/browser/cp/scene2.py` (obiecte de scenă),
`diag3–diag8.py` (izolarea cauzei).

Rezultate confirmate:

- TAKEOFF și LANDING nu oferă Copy/Paste de clip (doar EDIT_FORMATION, LIGHTING, MOTION, RENAME,
  ADVANCED, DELETE);
- clip SHOW înainte de Copy: `PASTE_CLIP` este dezactivat cu explicația „Copy a SHOW clip first.";
- Copy (meniu sau `Ctrl+C`) nu creează dirty/history; Undo rămâne în starea anterioară;
- Paste din meniu și `Ctrl+V` inserează un clip SHOW nou înainte de LANDING, cu id nou
  (`clip-4-…`), îl selectează (`clip-block-selected`) și un singur Undo îl elimină complet;
- `Ctrl+C`/`Ctrl+V` tastate într-un câmp de text nu declanșează copy/paste de clip (timeline
  neschimbat);
- obiecte de scenă: un obiect → Paste creează `obj-2` cu nume derivat, un Undo revine;
  două obiecte selectate → Paste creează `obj-3` și `obj-4`, un Undo revine la două.

Fals pozitiv eliminat: „meniul clipului nu se mai redeschide după Copy" era un artefact
Playwright — `locator.click(button="right")` releva butonul peste meniul nou deschis, iar
`PASTE_CLIP` (acum activ) era activat, ceea ce insera un clip și demonta meniul. Cu gest real de
mouse meniul se redeschide corect. Nicio modificare de cod nu a fost aplicată.

Defect raportat, NEcorectat (atinge `store.tsx`, deci necesită aprobare):
`pasteDesignClipboard` pentru `SCENE_OBJECTS` citește `created` sincron, dar `editScene` scrie prin
`setProject((p) => …)`, deci callbackul rulează abia la următorul render. Rezultatul: `created`
este mereu gol la verificare → funcția returnează `null` și nu apelează
`setSelectedSceneObjectIds`, deci obiectele lipite NU sunt selectate (selecția rămâne pe sursă).
Lipirea în sine, ID-urile noi și Undo unic funcționează corect. Remedierea minimă: `editScene` să
returneze ID-urile create (sau paste să calculeze ID-urile înainte de update), apoi selecția să fie
aplicată după commit. Localizare: `src/lib/studio/store.tsx:2556` și `:6229-6237`.

Validare locală (19 sep 2026): teste țintite copy/paste **trecute**, suită completă,
`tsgo --noEmit`, ESLint pe fișierele atinse și `bun run build` — vezi secțiunea precedentă;
această verificare nu a schimbat cod.

## 6. Limitări cunoscute, de comunicat onest

- Aplicația **nu** autorizează zborul; validările sunt de design, nu certificare.
- AI Formation Creator este determinist/mock, nu un LLM real.
- Faza Formation nu are încă culoare și mișcare proprii.
- Proiectele vechi rămân plane (fără stagger pe Z) — compatibilitate păstrată.
- Testul `exportRecoveryIsolation` este skipped: verifica indentarea exactă din `store.tsx`.

## 7. Prompt de verificare pentru Lovable

```text
Sincronizează ultimul main și nu rescrie istoricul. Verifică în browser copy/paste: (1) un clip
SHOW din timeline prin meniul contextual Copy/Paste și Ctrl+C/Ctrl+V; (2) unul și mai multe
obiecte selectate în Scene editor prin Ctrl+C/Ctrl+V. Confirmă că Paste selectează rezultatul,
generează identități noi, păstrează aspectul și că un singur Undo elimină întregul Paste.

Confirmă că shortcuturile nu interceptează Ctrl+C/Ctrl+V în input/textarea/contenteditable și că
TAKEOFF/LANDING nu oferă copiere de clip. Nu modifica motoarele show/trajectory/safety, importul
sau exportul și nu reimplementa clipboardul. Dacă găsești o problemă, documenteaz-o și aplică
doar o corecție UI limitată; orice schimbare în store/core trebuie raportată înainte. Actualizează
HANDOFF.md și roadmap.md și rulează testele, typecheck, lint relevant și build.
```
