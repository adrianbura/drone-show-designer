# Deschiderea show-ului A & B în editor

## Rezultat
- Show-ul „A & B — Wedding Story” devine proiectul deschis în spațiul de lucru.
- Editorul afișează 200 de drone, cele 11 segmente și efectele de lumină deja create.
- Fișierul audio rămâne neîncorporat și poate fi reatașat manual.

## Implementare
- Adaug proiectul generat ca date inițiale ale editorului, folosind același format canonic de proiect folosit la Open/Save.
- Păstrez fișierul descărcabil existent și nu modific motoarele de traiectorie, siguranță sau export.
- Verific în browser titlul, flota, durata și timeline-ul după încărcare.

## Limită importantă
Acesta rămâne un design editabil, nu un show validat pentru zbor sau pregătit automat pentru ESSP. Validarea completă trebuie refăcută după ajustarea traseelor și reatașarea melodiei.
