# Drumul până la o aplicație profesională, terminată

## Ce am analizat

Am recitit ghidul oficial Skybrush ("Quick guide to drone show design") și am auditat toată
aplicația. Skybrush impune o ordine strictă de 11 pași, iar tot ce e tehnic e automatizat:

1. inițializează show-ul → 2. grilă de decolare + decolare automată → 3. creează formații →
4. le pune într-un storyboard → 5. recalculează tranzițiile automat → 6. întoarcere la bază +
aterizare → 7. verificare de siguranță + validare completă → 8. lumini (culori simple, apoi
efecte parametrice) → 9. opțional pyro/yaw → 10. export (.skyc, .csv, PDF de validare) →
11. gata.

Aplicația noastră are deja, la calitate bună și testată, aproape tot motorul: formații
(inclusiv text și SVG), tranziții cu stagger și valuri de plecare, siguranță completă,
geofence GPS, Scene Composer, catalog de efecte, timeline, export JSON/CSV/ESSP, undo/redo,
lifecycle de proiect. Peste 1300 de teste trec.

Ce lipsește nu e motorul. Lipsesc: **un traseu ghidat de la gol la show gata**, **un raport
de validare pe care îl poți da autorităților**, **muzica sincronizată real** și **exportul
recunoscut în industrie**.

## Ce propun să facem, în această ordine

### Etapa 1 — Traseul ghidat (cel mai mare câștig de utilizabilitate)
Un panou "Show setup" care duce utilizatorul prin exact pașii Skybrush, în ordine, cu bifă
la fiecare: locație și perimetru → grilă de decolare → decolare → formații → storyboard →
tranziții → întoarcere și aterizare → siguranță → lumini → export. Fiecare pas spune ce e
gata, ce lipsește și te duce cu un click la unealta care rezolvă. Un începător termină un
show fără să știe unde e fiecare panou.

### Etapa 2 — Grilă de decolare, decolare, întoarcere și aterizare automate
Astăzi fazele TAKEOFF/LANDING există, dar nu sunt generate cu un buton, din parametri
(distanță între drone, rânduri decalate, viteză de urcare, altitudine de așteptare). Adăugăm
"Create takeoff grid", "Takeoff", "Return to home", "Land" — patru butoane, fiecare cu
parametrii lui, care scriu clipuri canonice în timeline.

### Etapa 3 — Raport de validare PDF
Skybrush exportă un PDF de validare folosit pentru autorizații. Generăm același lucru din
analiza completă pe care o avem deja: locație, perimetru, flotă, limite de viteză/accelerație,
separare minimă, autonomie, lista de avertismente, cu mențiunea clară că documentul nu
autorizează zborul.

### Etapa 4 — Blocarea exportului la ieșirea din perimetru
Ultimul punct deschis de siguranță: dacă o dronă trece perimetrul GPS, plafonul sau podeaua,
exportul se blochează, cu lista exactă de drone și momente.

### Etapa 5 — Muzică sincronizată real
Acum ritmul se introduce manual. Adăugăm detecție de bătăi din fișierul audio, grilă de
bătăi pe timeline și lipirea clipurilor și a cue-urilor de lumină pe bătaie.

### Etapa 6 — Text din fonturi reale
Import SVG cu litere convertite în contururi, grupuri per literă, distribuție uniformă pe
contur, previzualizare și verificare de separare înainte de Apply. Deblochează orice font.

### Etapa 7 — Export recunoscut în industrie
Formatul Skybrush `.skyc` este momentan doar declarat, nu implementat. Îl construim după
specificația publică, plus CSV per dronă cu antet configurabil pentru celelalte instrumente.
Aici voi cere confirmarea ta înainte, pentru că avem nevoie de o specificație verificată.

### Etapa 8 — Curățenie și încredere
Împărțirea magazinului central de date (acum un singur fișier foarte mare) în bucăți
întreținebile și teste reale în browser pe viewport-ul 3D și pe timeline.

## Detalii tehnice

- Etapa 1: nou `src/lib/studio/showSetup.ts` — proiecție pură peste proiect, fără mutații;
  `ShowSetupPanel.tsx`; secțiune nouă în `workspaceSections.ts`. Reutilizează
  `showReadiness.ts` pentru starea verificărilor.
- Etapa 2: nou `src/lib/show/preshow/takeoffGrid.ts` + `rth.ts`; scriere de clipuri prin
  acțiuni noi în `store.tsx` (o singură intrare de history per operație). Respectă
  `clipPhase()` ca autoritate unică.
- Etapa 3: `src/lib/report/validationReport.ts` (pur, generează structura) + randare PDF în
  client; sursa de date exclusiv `fullshow` + `siteGeofence`, fără calcule noi de siguranță.
- Etapa 4: `scanGeofence` integrat în `exportEligibility`/`exportPreflight`; fără schimbări
  de schemă de export.
- Etapa 5: detecție de bătăi în client (energie spectrală, fără dependențe native); extindere
  `audio.ts` cu `detectBeats`, snapping opțional în timeline.
- Etapa 6: extinde `src/lib/show/svg/**` cu grupare per contur/literă și distribuție pe
  lungime de arc; `SvgImportPanel.tsx` primește previzualizarea și diagnosticul.
- Etapa 7: `src/lib/adapters/skyc.ts` conform specificației publice; adaptorul rămâne
  `planned` până trece testele de conformitate.
- Etapa 8: împărțirea `store.tsx` pe felii, fără schimbări de comportament; Playwright pentru
  timeline, gizmo și viewport.

Reguli păstrate: nicio metodă nouă de calcul al siguranței, panourile noi sunt proiecții pure,
o mutație canonică = o intrare de undo, typecheck + lint + build + toată suita de teste înainte
de fiecare raportare.

## Despre conducerea proiectului

Preiau conducerea: eu propun ordinea, implementez, testez și îți raportez la fiecare etapă.
Un lucru trebuie să fie clar: **nu pot vorbi direct cu ChatGPT** — nu am canal către el. Poate
citi `HANDOFF.md` din GitHub, iar tu îmi transmiți ce spune, dacă vrei. Nu e nevoie pentru a
termina aplicația; îl țin actualizat prin `HANDOFF.md` după fiecare etapă.

## Ce încep dacă aprobi

Etapa 1 (traseul ghidat) și Etapa 2 (decolare/aterizare automate) — împreună schimbă cel mai
mult senzația de "unealtă profesională, ușor de folosit".
