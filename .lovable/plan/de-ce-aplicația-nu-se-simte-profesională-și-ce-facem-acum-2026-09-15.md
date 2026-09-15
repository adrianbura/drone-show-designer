# De ce aplicația nu se simte profesională — și ce facem acum

Nu am mai propus din capul meu. Am deschis aplicația, am încărcat show-ul tău real de 150 de drone și m-am uitat la ce vede un om care lucrează cu ea.

## Ce am constatat, pe dovezi

**1. Aplicația se contrazice singură.** Am importat arhiva ta: scrie „150/150 fișiere, grilă 15×10, 9 min 53 s" — dar în capul aplicației scrie tot „48 DRONE", iar cronologia de jos scrie „Cronologie goală". Trei locuri, trei adevăruri diferite despre același show. Asta e senzația de „neprofesional", mai mult decât orice funcție lipsă.

**2. Ecranul e supraaglomerat.** Am numărat 25 de panouri vizibile în același timp. Coloana din stânga îngrămădește proiectul, biblioteca de figuri, laboratorul vizual, imaginea de referință, două creatoare AI și lista de formații — toate într-un singur sul. Nimic nu spune „acum fă asta".

**3. Show-ul tău real e ascuns.** Locul unde îți deschizi show-ul care zboară efectiv stă sub fila „Advanced", cu un avertisment galben. Ar trebui să fie una din primele lucruri de pe ecran.

**4. Previzualizarea nu arată ca un spectacol.** Dronele sunt puncte mici gri-albăstrui pe o grilă tehnică, camera stă sus și fix. Nu poți arăta asta unui client și nu poți judeca artistic show-ul din ea.

**5. Un defect real în pagină.** Interfața se randează de două ori (același conținut, aceleași identificatoare duplicate). La 150 de drone browserul face muncă dublă degeaba.

## Concluzia

Aplicația are motoare bune — geometrie, siguranță, geofence, raport PDF, formatul real al dronelor citit bit cu bit. Ce nu are e **produsul**: un singur show clar, un ecran care te conduce, și o imagine care arată ca un spectacol. Astea sunt problema acum, nu următoarea funcție.

## Pașii

### Pasul 1 — Un singur show, un singur adevăr
Când deschizi un show real, aplicația devine acel show: numărul de drone, durata și cronologia se aliniază, iar starea „gol" dispare. Un singur loc care spune câte drone, cât durează și în ce stare e.

### Pasul 2 — Ecranul care te conduce
Din 25 de panouri simultane rămân trei zone după ce lucrezi, nu după cum e scris codul: **Show** (locul, flota, decolarea/aterizarea), **Creează** (figuri, text, imagine, AI), **Verifică și livrează** (siguranță, raport, export). Restul se deschide la cerere. Deschiderea unui show real urcă în față, lângă „Open".

### Pasul 3 — Previzualizare de spectacol
Un mod „ca la spectacol": cer negru, fără grilă tehnică, drone cu strălucire și dimensiune care ține cont de distanță, cameră din poziția publicului cu mișcare lentă. Butonul stă lângă redare, iar modul tehnic rămâne neschimbat pentru lucru.

### Pasul 4 — Curățenie și viteză la scară
Eliminarea randării duble, apoi măsurat cu show-ul tău de 150 de drone și cu unul de 500: cât durează încărcarea, cât de fluidă e redarea, unde se blochează. Rezultatele se scriu într-un raport, nu rămân pe cuvânt.

## Detalii tehnice

- Pasul 1 reconciliază `referenceShow` cu `project.droneCount` și cu starea cronologiei; fără calcule noi de siguranță, doar o singură sursă de adevăr pentru afișare.
- Pasul 2 este regrupare de panouri în `Inspector.tsx` și în coloana din stânga; panourile rămân proiecții pure, nicio logică mutată.
- Pasul 3 adaugă un mod de randare în `Viewport3D` (material emisiv, bloom, cameră din publicul definit în `ShowSite.audience`), fără a schimba traiectoriile.
- Pasul 4 elimină montarea duplicată a Inspectorului și adaugă măsurători Playwright cu arhiva reală și cu un show de 500.
- Reguli păstrate: `clipPhase()` rămâne singura autoritate de fază, o mutație = o intrare de undo, typecheck + lint + build + toată suita de teste înainte de fiecare raportare.

## Ce NU intră

Pirotehnie, control la sol, gestiune de clienți, detectare automată a ritmului (tu decizi momentele), `.skyc` — dronele tale folosesc ESSP, pe care aplicația îl citește deja bit cu bit.
