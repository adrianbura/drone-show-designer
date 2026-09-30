# Refacerea regiei „A & B — Wedding Story”

## Rezultat
- Show-ul începe cu toate cele 200 de drone răspândite ca o boltă de stele.
- Carul Mare apare clar în această boltă, apoi stelele devin sursa vizuală din care se nasc imaginile nunții.
- Fiecare imagine folosește doar dronele necesare pentru a fi lizibilă de la 150 m; celelalte sunt stinse și se poziționează pentru momentul următor.
- Inima are contur și puncte în interior, apoi pulsează ca o bătaie de inimă.

## Regie propusă
1. **Cerul de stele** — 200 de puncte cu adâncimi și intensități diferite; Carul Mare este evidențiat progresiv.
2. **Două destine** — două trasee luminoase se desprind din stele și se apropie; restul cerului se stinge treptat.
3. **A & B** — inițialele se formează din două grupuri, cu o parte a flotei deja în pregătire pentru inimă.
4. **Inima vie** — contur clar plus umplere aerisită; pulsația mișcă forma ușor prin scalare și sincronizează intensitatea luminii.
5. **Countdown** — un singur inel mare și curat; numai dronele necesare sunt aprinse, iar celelalte pregătesc inelele.
6. **Inelele** — două contururi aurii interconectate, construite din grupurile deja pregătite.
7. **Constelația iubirii** — imaginea se dizolvă din nou în stele, cu trasee luminoase subtile.
8. **Infinit și final A & B** — simbolul infinit se transformă în compoziția finală inimă + inițiale, apoi stelele se sting controlat înainte de aterizare.

## Implementare
- Refac formațiile cu bugete diferite de drone și scene compuse acolo unde o imagine are mai multe părți.
- Folosesc participarea `SMART_PREPARE` și luminile de rezervă stinse, astfel încât dronele nefolosite să se deplaseze discret spre următoarea imagine.
- Creez o formație dinamică pentru pulsația geometrică a inimii și păstrez efectul luminos sincronizat.
- Păstrez durata de 4:23,2 și reperele manuale ale melodiei; audio rămâne neîncorporat și trebuie reatașat.
- Înlocuiesc proiectul A & B deschis automat și păstrez formatul normal Save/Open al aplicației.

## Verificare
- Confirm în editor: 200 drone, durata, succesiunea scenelor și numărul de drone folosit în fiecare imagine.
- Verific vizual Carul Mare, inelul unic, inima umplută și pulsația în redare.
- Rulez analiza completă și raportez separat orice conflict sau problemă de zbor; rezultatul rămâne design editabil până la validarea reală.