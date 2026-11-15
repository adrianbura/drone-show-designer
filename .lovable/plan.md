# Plan: clipurile „Make editable” = scenele afișate pe timeline

## A. Verificarea ipotezei (măsurată pe show-ul real `ESSP_8_12_mainv4_2f6001-2.zip`)

Am rulat un test temporar, fără să modific nimic: arhivă -> `buildReferenceShow` -> `analyzeReferenceShow` -> `extractReferenceTimeline(show, report)`, exact ca în `store.tsx:4914`.

- Bara de pe timeline (`Timeline.tsx:867`) desenează **toate cele 138 de segmente** din `report.segments`: 45 STATIC, 41 GLOBAL_TRANSLATION, 20 DYNAMIC_DEFORMATION, 8 RIGID_MOTION, 5 GLOBAL_ROTATION, 14 FORMATION_TRANSITION, 1 TAKEOFF, 4 LANDING.
- 119 dintre ele sunt în `SCENE_CLASSES`.
- Doar **34** au o durată de cel puțin 4 s.
- „Make editable” produce **36 de clipuri**: TAKEOFF, 34 SHOW și LANDING.

Concluzia despre ipoteză:
1. **Partea 1 este corectă în privința pragului.** `minSceneSeconds = 4` (`extract.ts:183`, filtrul de la `:198`) elimină 85 din cele 119 scene. Acesta este singurul pas care schimbă numărul de clipuri pe datele reale.
2. **Regula de eliminare prin suprapunere nu elimină nimic aici.** `endTime <= acceptedEnd + 0.001` (`:211`) respinge un segment doar dacă se termină în interiorul celui acceptat. Pe datele reale, segmentele vecine se suprapun cu 0,25 s, dar se termină mai târziu, deci trec.
3. **Granițele se schimbă oricum.** Hold-ul fiecărui clip păstrează finalul segmentului, dar începutul clipului este capătul clipului anterior. Timpul segmentelor eliminate devine `transition`. Exemple:
   - `essp-clip-03`: start 28,75, transition 4,75, hold 7,5, final 41,00. Acoperă SEG-004 (tranziție), SEG-005 (static 2,5 s) și SEG-006 (dinamic 33,50–41,00).
   - `essp-clip-09`: transition 29,25 s. Înghite SEG-022…SEG-027.
   - `essp-clip-13`: transition 67 s. Înghite ~30 de segmente scurte, între 128 și 195.
4. **Partea 2 este corectă.** `groupVisualIdentity` este doar opțional și nu este transmis din `store.tsx`. HANDOFF consemnează că re-unirea clipurilor statice cu cele dinamice are încă incompatibilități la editare.

## B. Opțiuni de corectare

Presupunere de lucru (de confirmat): „scenă afișată” înseamnă un segment din `SCENE_CLASSES` aflat între decolare și aterizare. Segmentele FORMATION_TRANSITION rămân tranziții, nu clipuri.

**Opțiunea 1 — recomandată: o singură proiecție canonică a scenelor, folosită și de bară, și de extragere.**
- Adaug în `native/` o funcție pură `displayedSceneSegments(report)`. Ea ia segmentele din `SCENE_CLASSES` dintre decolare și aterizare, fără prag de durată, sortate. Suprapunerile de 0,25 s sunt rezolvate ca intervale semi-deschise: o scenă începe la `max(start, finalul scenei anterioare)`.
- `extractReferenceTimeline` folosește această funcție ca listă de candidați pe calea implicită. `minSceneSeconds` rămâne doar ca opțiune explicită; valoarea implicită devine 0.
- Timeline-ul evidențiază ca „scenă” exact aceleași intervale. Restul segmentelor rămân desenate ca tranziții, în aceeași bară.
- Rezultat așteptat pe show-ul real: TAKEOFF + 119 SHOW + LANDING. Hold-ul fiecărui clip este exact intervalul afișat. Tranziția este doar golul de FORMATION_TRANSITION dintre scene.
- Nu se modifică traiectoriile: stratul importat rămâne sursa de redare, iar octeții ESSP și raportul salvat rămân neatinși. Efectele rămân „solid” sau „necunoscut”, ca acum.

**Opțiunea 2 (minimă, doar în store):** transmit `{ minSceneSeconds: 0 }` în `store.tsx`. Numărul de clipuri ar ieși corect, dar bara și clipurile ar rămâne calculate în două locuri și s-ar putea despărți din nou. Prin urmare, nu o recomand.

**Opțiunea 3:** activez `groupVisualIdentity`. Este respinsă, fiindcă grupează mai multe segmente într-un singur clip și reintroduce re-unirea static/dinamic, care este încă blocată.

## C. Teste

Teste care se schimbă (aștept ca numărul de clipuri sau scene să crească; le ajustez doar unde aserțiunile depind de pragul de 4 s):
- `native/__tests__/extractTimeline.test.ts`: cazul implicit și cazul „explicitOff” (`:97–:99`, `:179–:184`).
- `native/__tests__/sceneDecomposition.test.ts` și `comparison.test.ts`, care folosesc extragerea implicită.
- `show/__tests__/integration/esspLightingExport.test.ts`, `adapters/__tests__/esspProductionExport.test.ts`, `show/__tests__/effectiveTrajectory.test.ts`, `studio/__tests__/geometryApplyEndToEnd.test.ts` și `support/geometryApplyHarness.ts`, plus `acceptance/support/productionFixtures.ts`. Aici trebuie confirmat că testele rămân verzi; dacă depind de un anumit număr de clipuri, valoarea se actualizează explicit.
- Testele `groupVisualIdentity` rămân neschimbate.

Teste noi de regresie:
1. **Granițe egale:** pentru fiecare scenă din `displayedSceneSegments(report)`, există exact un clip SHOW, iar intervalul lui de hold este identic cu ea, cu toleranță 1 ms. Testul se face pe un show sintetic cu scene de 1 s, 2,5 s și 20 s.
2. **Scenele scurte nu se pierd:** o scenă statică de 1 s între două dinamice produce un clip propriu.
3. **Suprapuneri:** segmente care se suprapun cu 0,25 s dau clipuri care nu se suprapun și nu lasă goluri.
4. **Fidelitate:** pozițiile și culorile redate din stratul importat sunt identice înainte și după extragere, la momente eșantionate. Octeții sursă și raportul salvat rămân neschimbați.
5. **Nimic promovat:** după `reseedReferenceSignatures`, lista de promovări este goală pentru toate clipurile.
6. **Undo:** o singură apăsare de Undo după „Make editable” restaurează proiectul anterior.
7. **Show-ul real, doar local:** pe arhiva reală, numărul de clipuri SHOW este egal cu numărul de scene afișate (119), fiindcă arhiva nu este în repo.

## D. Riscuri

- **Static/dinamic:** opțiunea 1 nu re-unește nimic, fiecare segment devine propriul clip. Riscul se mută însă în altă parte: scenele de 1 s sunt clipuri cu tranziție aproape de 0,001 s. Editarea uneia, de exemplu prin mutare, scalare sau durată, poate cere viteze imposibile față de vecinele lipite. Garda de validare existentă trebuie să refuze, nu să replanifice.
- **Performanță:** de la 36 la 121 de clipuri înseamnă mai multă descompunere pe scene și mai multe semnături. Aplicarea durează deja 25–50 s în browserul de test, deci trebuie măsurată. Dacă e prea lent, decompunerea pe obiecte poate rula doar la cerere pentru scenele sub 4 s.
- **Undo:** extragerea rămâne o singură intrare `pushSnapshot`. Riscul e mic, dar istoricul crește cu un proiect mai mare.
- **Garda de promovare / reseeding:** fiecare clip nou primește o legătură și o semnătură. Dacă semnătura unui clip scurt e instabilă, clipul ar putea fi considerat modificat și promovat fals. Testul 5 acoperă acest caz.
- **Editare:** 119 clipuri înseamnă o listă lungă pentru utilizator și pentru agent („scena 5” devine alt segment decât azi). Se notează în HANDOFF.
- **Efecte:** detectarea luminii (dark travel + reveal) se face pe fiecare scenă. Pe scene scurte poate fi neconfirmată; rămâne „necunoscut”, nu se inventează nimic.

## Recomandare

Opțiunea 1. După aprobare: implementare, teste, verificare în browser pe show-ul real (număr de clipuri, granițe, Undo) și actualizarea HANDOFF.md și roadmap.md.

## De confirmat

Segmentele FORMATION_TRANSITION rămân tranziții, nu clipuri separate. Dacă vrei câte un clip pentru absolut fiecare bară colorată (138), spune-mi și ajustez planul.
