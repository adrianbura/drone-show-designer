# Ce ne mai lipsește și cu ce continuăm

## Ce am făcut acum

Am recitit tot codul aplicației și am studiat cum lucrează programele profesionale:
Skybrush Studio, Verge Aero, Drone Show Software (SPH), Finale 3D, Dronisos, HighGreat.
Toate urmează același drum: creezi figuri → le pui pe o linie de timp → adaugi lumini,
muzică și eventual efecte pirotehnice → rulezi verificările de siguranță → obții un
document de validare → exporți un fișier pe care îl încarcă echipa de zbor → previzualizezi.

## Unde suntem noi

Motorul e complet și solid: figuri (grilă, cerc, sferă, text cu font real, SVG, bibliotecă
de 10 figuri + sirena animată), scene cu mai multe obiecte simultan, tranziții cu plecări
decalate și valuri, lumini cu catalog de efecte, figuri animate, verificări de siguranță,
perimetru GPS cu blocarea exportului, grilă de decolare, decolare și aterizare automate,
traseu ghidat pas cu pas, export JSON/CSV/ESSP, salvare/deschidere, undo/redo. Peste 1350
de verificări automate trec.

Comparativ cu programele profesionale, ne lipsesc patru lucruri mari și câteva mai mici.

## Planul, în ordinea în care propun să lucrăm

### 1. Document de validare descărcabil (PDF)
Cel mai mare gol față de concurență. Skybrush scoate un PDF folosit la autorizații, cu
grafice. Facem același lucru din analiza pe care o avem deja: locația și perimetrul, flota,
limitele de viteză și accelerație, separarea minimă în timp (grafic), altitudinea maximă,
autonomia, lista completă de avertismente și mențiunea clară că documentul nu autorizează
zborul.

### 2. Muzică sincronizată real
Acum ritmul se introduce manual. Adăugăm detecția bătăilor direct din fișierul audio,
o grilă de bătăi vizibilă pe linia de timp și lipirea clipurilor și a momentelor de lumină
pe bătaie. Asta schimbă cel mai mult calitatea artistică a show-urilor.

### 3. Copiere / lipire și șabloane de show
Cerere veche a ta, rămasă deschisă. Copiezi un clip sau o scenă întreagă și o lipești în
altă parte, plus câteva șabloane de show gata făcute (deschidere, secvență de logo, final)
pe care le adaptezi la numărul tău de drone.

### 4. Imagine → figură, mai puternic
Programele profesionale eșantionează orice desen sau fotografie pe numărul exact de drone.
Avem baza; o ducem mai departe: control pe contur vs. umplere, previzualizare cu verificarea
separării înainte de aplicare și păstrarea proporțiilor reale.

### 5. Export recunoscut în industrie (.skyc)
Formatul Skybrush este momentan doar declarat, nu construit. Îl implementăm după specificația
publică, plus CSV per dronă cu antet configurabil. Aici îți cer confirmarea înainte de start,
pentru că avem nevoie de o specificație verificată; până trece testele, rămâne marcat ca
„în lucru”.

### 6. Previzualizare de prezentare
Un mod de vizualizare „ca la spectacol” (cer negru, lumini cu strălucire, cameră lentă) pe
care îl poți filma și trimite clientului spre aprobare. Concurența vinde mult pe asta.

### 7. Curățenie și încredere
Împărțirea fișierului central de date (acum foarte mare) în bucăți întreținebile, fără
schimbări de comportament, plus teste reale în browser pe linia de timp și pe vizualizarea 3D.

## Ce NU propun să facem
Efecte pirotehnice, software de control în ziua zborului, gestiune de proiecte cu clienți și
rularea mai multor show-uri simultan. Sunt lucruri de firmă de operare, nu de unealtă de
design, și ar dilua proiectul.

## Detalii tehnice

- Pasul 1: `src/lib/report/validationReport.ts` (pur, doar proiecție peste `fullshow` +
  `siteGeofence`, fără calcule noi de siguranță) + randare PDF în client; graficele din
  seriile deja calculate de analiză.
- Pasul 2: extindere `src/lib/show/audio.ts` cu `detectBeats` (energie spectrală în client,
  fără dependențe native); grilă de bătăi în `Timeline.tsx`; snapping opțional, niciodată
  impus.
- Pasul 3: comenzi noi de copiere/lipire în `store.tsx` (o singură intrare de history per
  operație) + `src/lib/studio/showTemplates.ts`.
- Pasul 4: extinderea `src/lib/visual/image/**` cu control contur/umplere și diagnostic de
  separare în panoul de import.
- Pasul 5: `src/lib/adapters/skyc.ts`; adaptorul rămâne `planned` în registru până trec
  testele de conformitate.
- Pasul 6: mod de randare separat în `Viewport3D.tsx`, fără schimbări în motor.
- Pasul 7: împărțirea `store.tsx` pe felii, comportament identic; Playwright pentru timeline,
  gizmo, viewport.

Reguli păstrate: nicio metodă nouă de calcul al siguranței, panourile noi sunt proiecții pure,
o mutație canonică = o intrare de undo, typecheck + lint + build + toată suita de teste înainte
de fiecare raportare.

## Ce încep dacă aprobi

Pasul 1 (documentul de validare PDF) și Pasul 2 (muzica sincronizată real) — împreună acoperă
cele două goluri cele mai vizibile față de programele profesionale.
