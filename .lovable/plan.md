# Propuneri de evoluție — Drone Show Designer

## Scopul documentului

Acest document prezintă propunerile tehnice curente pentru dezvoltarea aplicației **Drone Show Designer**, împreună cu riscurile, beneficiile și ordinea recomandată de implementare. Este destinat managerului de produs pentru aprobarea direcției și alocarea resurselor.

---

## 1. Context tehnic actual

Aplicația are în prezent:

- **Editor timeline** cu formații, clipuri, tranziții și efecte de lumini.
- **Generare de formații** din AI Visual Creator, AI Formation Creator, SVG import, text determinist și grid.
- **Analiză de siguranță** full-show: separare minimă, viteză, accelerație, jerk, autonomie baterie.
- **Export** JSON, CSV și ESSP pentru drone reale.
- **Simulare virtuală** a flotei (fără hardware fizic).
- **Import ESSP real** — s-a studiat o arhivă reală cu 150 drone (inclusiv „Scene 31”).

**Problema centrală descoperită:** atunci când înlocuim o formație importată (de exemplu norul static din Scene 31) cu text sau altă geometrie, re-atribuirea celor 150 de drone pe noua formă produce **violări reale de separare în tranziție** (~0,96 m față de minimul 2,50 m). Acest lucru blochează Apply indiferent de sursa geometriei (glyph pack propriu sau SVG).

---

## 2. Propuneri de funcționalități

### Propunerea A — Staggered transitions (tranziții etapizate)

**Descriere:**
Permite ca dronele să plece spre noua formație în grupuri decalate, nu toate simultan. Fiecare grup primește un `startOffset` controlat, iar durata totală de tranziție se adaptează astfel încât să nu existe suprapuneri periculoase.

**De ce este necesar:**
- Deblochează Scene 31 și orice altă editare de formație cu re-atribuire complexă.
- Reduce congestionia în aer în momentele de schimbare geometric.
- Crește șansa ca show-ul să treacă validarea de siguranță fără a forța designerul să modifice formațiile.

**Riscuri:**
- Atinge nucleul de planificare a traiectoriilor (`src/lib/show/trajectory/`).
- Poate afecta durata totală a show-ului și sincronizarea cu muzica.
- Necesită teste de regresie puternice pe proiecte reale.

**Valoare de business:**
- Cel mai mare impact imediat: show-uri complexe devin editabile.
- Reduce timpul de iterație pentru designer.

---

### Propunerea B — Stagger pe Z ca politică globală de siguranță

**Descriere:**
Introduce un parametru global care aplică un decalaj intenționat pe axa adâncimii (Z) pentru fiecare formație generată. Dronele rămân vizual aliniate din perspectiva publicului, dar fizic stau pe mai multe planuri de adâncime. Dacă o dronă cade, coloana ei de cădere este liberă.

**De ce este necesar:**
- Măsură de siguranță reală, recunoscută în industrie.
- Nu depinde de designer să-și amintească să o activeze.
- Se aplică după generarea geometriei și înainte de validare.

**Override per formație:**
Anumite formații trebuie să rămână plane (text citit de aproape, efecte 2D pe sol). Se propune un flag per formație: `forceFlat`.

**Riscuri:**
- Modifică geometria tuturor formațiilor noi.
- Poate afecta densitatea maximă a flotei într-o zonă.
- Proiectele vechi rămân plane (compatibilitate păstrată).

**Valoare de business:**
- Diferențiator de siguranță față de concurență (Skybrush nu are așa ceva explicit).
- Reduce riscul de coliziune în caz de defecțiune.

---

### Propunerea C — Catalog unificat de efecte (Mișcare + Culoare)

**Descriere:**
Creează o singură secțiune în aplicație — „Effects Catalog" — de unde utilizatorul poate aplica preseturi de mișcare și culoare peste selecția curentă (clip, grup de drone sau formație întreagă).

**Preseturi existente care vor intra în catalog:**
- Mișcare: PULSE, ORBIT, WAVE, FLAP, TWIST, DRIFT, FLAG_WAVE.
- Culoare: APPEAR, COLOR, RHYTHM, ADVANCED.
- Tranziții geometrice: AUTO, SYNCHRONIZED, STAGGERED.

**Funcționalități propuse:**
- Preview live în viewport înainte de apply.
- Indicator vizual de siguranță (verde/ galben/ roșu) pentru fiecare preset aplicat.
- Favorite și istoric „aplicate în show".
- Aplicare pe selecție multiplă.

**Riscuri:**
- Refactorizare UI semnificativă în Inspector.
- Risc de regresie la descoperirea efectelor existente.

**Valoare de business:**
- Crește viteza de lucru și reduce curba de învățare.
- Face aplicația mai competitivă cu Skybrush Studio (Blender), care are workflow similar.

---

### Propunerea D — SVG Text ca sursă de formație de primă clasă

**Descriere:**
Transformă importul SVG într-un flux dedicat pentru text: utilizatorul importează un SVG cu litere convertite în contururi, iar aplicația distribuie automat dronele pe trasee, cu spațiere uniformă după lungimea de arc.

**Flux propus:**
1. Import SVG (din Illustrator/Inkscape/etc).
2. Selecție litere / cuvinte ca grupuri editabile.
3. Distribuire automată a dronelor pe contururi.
4. Preview + validare separare.
5. Apply ca formație nouă.

**De ce este necesar:**
- Oferă fonturi reale, nu glyph pack intern limitat.
- Designerul poate folosi orice stil tipografic.
- Rămâne determinist și validabil.

**Riscuri:**
- Necesită îmbunătățiri la parserul SVG și la alocarea pe grupuri.
- Trebuie gestionate cazurile cu prea multe sau prea puține puncte față de participare.

**Valoare de business:**
- Deschide aplicația către designeri grafici profesioniști.
- Elimină blocajul „fontul nu arată bine".

---

## 3. Ordinea recomandată de implementare

1. **Staggered transitions** — impact maxim, deblochează editarea reală a show-urilor importate.
2. **Stagger pe Z** — măsură de siguranță cu impact larg, relativ izolată.
3. **SVG Text ca sursă de primă clasă** — îmbunătățește calitatea vizuală a textului.
4. **Catalog unificat de efecte** — polish UX, crește productivitatea.

---

## 4. Metrici de succes propuse

| Funcționalitate | Metrică | Țintă |
|-----------------|---------|-------|
| Staggered transitions | Scene 31 poate fi editat fără violări de separare | Apply reușit pe arhiva reală |
| Stagger pe Z | Toate formațiile noi trec validarea cu separare > minim | 100% formații noi |
| SVG Text | Timp de la import SVG la formație validă | < 2 minute |
| Catalog efecte | Timp de aplicare a unui preset | < 3 clickuri |

---

## 5. Resurse necesare (estimare inițială)

| Etapă | Durată estimată | Teste noi estimate |
|-------|-----------------|----------------------|
| Staggered transitions | 2–3 săptămâni | 20–30 teste |
| Stagger pe Z | 1 săptămână | 10–15 teste |
| SVG Text | 2 săptămâni | 15–20 teste |
| Catalog unificat efecte | 2–3 săptămâni | 10 teste UI |

---

## 6. Întrebări pentru decizie

1. Care este prioritatea maximă: deblocarea editării show-urilor reale (Propunerea A) sau îmbunătățirea siguranței (Propunerea B)?
2. Acceptăm schimbarea duratei totale a show-ului ca efect al staggered transitions?
3. Vrem să păstrăm compatibilitatea 100% cu proiectele salvate anterior, sau acceptăm o migrare controlată?
4. Catalogul de efecte ar trebui să înlocuiască panourile existente sau să coexiste inițial?

---

## 7. Recomandare finală a echipei tehnice

Se recomandă **pornirea cu Propunerea A (Staggered transitions)**, deoarece:

- Este blocantă pentru show-uri reale (inclusiv Scene 31).
- Are cel mai mare impact asupra capacității de a livra un produs funcțional.
- Fundația tehnică există deja; este o extensie, nu o rescriere.

După stabilizare, se continuă cu **Propunerea B (Stagger pe Z)** pentru diferențierea de siguranță, apoi **Propunerea D (SVG Text)** și **Propunerea C (Catalog unificat)**.
