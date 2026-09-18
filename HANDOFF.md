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
- **Ultima stare analizată:** commit Lovable `c9d9ac7` — proba de frame-time 150/500 finalizată.
- **Prioritate activă:** reducerea costului viewportului prin randare la cerere, urmată de
  re-măsurarea acelorași scenarii.
- **Validare încă necesară:** cifrele existente provin din Playwright headless cu SwiftShader;
  după optimizare trebuie completate cu măsurători pe browser și GPU real.
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

SCOASE din plan, decizie a proprietarului: detecția automată de bătăi (momentele se
compun manual, grila BPM manuală rămâne) și exportul `.skyc` (hardware-ul țintă
încarcă ESSP, format pe care aplicația îl citește și îl scrie deja bit cu bit).

Rămas, în ordinea de lucru:

1. **Costul de randare al viewportului** — redesenare doar la schimbare (invalidate on demand),
   apoi re-măsurare la 150/500; ținta e un cadru stabil la 500 de drone.
2. **Copy/paste + șabloane de show** — comenzi noi în `store.tsx` (o intrare de history
   per operație) + `src/lib/studio/showTemplates.ts`.
3. **Efecte de lumină avansate** peste preseturile existente.
4. **Imagine → figură mai puternic** (contur vs. umplere, diagnostic de separare).
5. **Curățenie**: împărțirea `store.tsx` pe felii, lint global, CI și teste Playwright pe
   timeline/gizmo/viewport; `.gitignore` pentru `__pycache__`/`.pyc`.

## 6. Limitări cunoscute, de comunicat onest

- Aplicația **nu** autorizează zborul; validările sunt de design, nu certificare.
- AI Formation Creator este determinist/mock, nu un LLM real.
- Faza Formation nu are încă culoare și mișcare proprii.
- Proiectele vechi rămân plane (fără stagger pe Z) — compatibilitate păstrată.
- Testul `exportRecoveryIsolation` este skipped: verifica indentarea exactă din `store.tsx`.
