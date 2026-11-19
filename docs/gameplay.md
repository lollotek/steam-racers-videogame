# Steam Racers · il gameplay di oggi

---

## 1\. Panoramica

Steam Racers è una corsa off-road a vapore in voxel art, tratta dal gioco da tavolo "Steam Races": quattro mezzi corazzati su circuiti sterrati, tre giri, armi e speronamenti. Vince chi taglia il traguardo per primo.

Le risorse che il giocatore gestisce in gara sono quattro e si legano tra loro:

| Risorsa | Cosa fa | Capitolo |
| :---- | :---- | :---- |
| **Punti Vapore (PV)** | pagano spinte, cambi di marcia, alcune armi e carte; troppi fanno esplodere la caldaia | 5 |
| **Punti Ferita (PF)** | la salute della scocca; a zero il mezzo è un relitto e si ritira | 6 |
| **Munizioni** | colpi delle armi, ricaricati dalle casse in pista | 7 |
| **Grinta** | guadagnata con lo spettacolo; paga la Difesa Attiva e alcune carte | 7 |

&nbsp;

I rivali sono tre piloti dell'IA (Rosso, Blu, Giallo): ognuno ha un suo arsenale e i suoi moduli e guida con le stesse regole del giocatore (marce, vapore, carte).

## 2\. Modalità e menu

| Voce di menu | Cosa offre |
| :---- | :---- |
| **1 giocatore** | Gran Premio o Gara singola contro tre IA |
| **2 giocatori** | le stesse modalità a schermo diviso (tastiera condivisa o due gamepad), più due IA |
| **Scuola guida** | un circuito con l'istruttore, senza rivali; proposta al primo avvio |
| **Garage** | mezzi, potenziamenti, moduli, armi, mazzo dei Trucchi, carrozzeria |
|  |  |
| **Opzioni / Comandi** | lingua, qualità, camera, audio, "Eventi di gara"; pagina dei comandi e delle regole |

Prima di una gara si sceglie la **difficoltà** (Facile, Normale, Difficile: velocità e crescita delle IA, e quanti Crediti si guadagnano), la pista e, nella gara singola

### 2.1 Gran Premio (Coppa Steam Racers)

- Una stagione: i 6 circuiti in fila (`src/tracks/index.json`), si può partire da uno qualsiasi.  
- A ogni gara premi in crediti per posizione (100.000 / 60.000 / 30.000 / 10.000 \$) più i sacchi di soldi raccolti in pista (5.000 \$ l'uno).  
- Tra una gara e l'altra l'**Officina** della stagione: i crediti comprano livelli di Accelerazione, Velocità massima, Pneumatici e Ammortizzatori, che valgono per la stagione.  
- Chi diventa relitto paga la riparazione con i crediti della stagione.  
- Alla fine vince la Coppa chi ha incassato di più. Le IA crescono di gara in gara;  
- Vincere la Coppa a Normale o Difficile sblocca la **Steam Special**.

### 2.2 Gara singola

Una pista, una gara secca. La griglia si decide casualmente. Ogni pista tiene il record personale sul giro. niente Officina, niente costo di riparazione.

### 2.3 Crediti e carriera

Due monete diverse:

- **crediti (\$)**: esistono solo dentro una stagione di Gran Premio e si spendono nell'Officina.  
- **Crediti**: la moneta della carriera, restano tra le partite e si spendono in Garage. Si guadagnano con la posizione d'arrivo, la prima vittoria e il primo podio su ogni pista, i record, la fine del Gran Premio, la Coppa (scalati per difficoltà: Facile × 0,75, Difficile × 1,25), la Scuola guida (una volta) e i trofei.

## 3\. Garage e mezzi

### 3.1 I mezzi

Sette mezzi, ognuno con le caratteristiche del tavolo (gruppo `vehicles.<id>` di `rules.js`) oltre a quelle di guida (velocità, accelerazione, tenuta, peso):

| Mezzo | Prezzo (Crediti) | Note |
| :---- | :---- | :---- |
| Rullo Distruttore | gratis | il mezzo di partenza |
| Volontà Imperiale | 900 |  |
| Buggy Zanzara | 1.500 | leggero e manovrabile |
| Mangia Asfalto | 2.200 |  |
| Truck Deserto | 3.200 | pesante: 3 slot per i moduli |
| Monster Bestione | 4.200 | pesante |
| Steam Special | si sblocca | vincendo la Coppa a Normale o Difficile |

Le caratteristiche del tavolo:

- **CAL** (Capacità della caldaia): quanti PV si tengono senza andare in zona rossa.  
- **AFF** (Affidabilità): rende più lenta la pressione, più larga la tacca del test e la tolleranza della partenza.  
- **RES** (Resistenza): si toglie dal danno di ogni colpo.  
- **MAN** (Manovrabilità): allarga la fascia della Prova di Partenza.  
- **PF**: 20 per tutti.

### 3.2 Schede del Garage

| Scheda | Cosa si fa |
| :---- | :---- |
| **Prestazioni** | barre delle caratteristiche, indice prestazioni, resa sui fondi |
| **Officina** | livelli di Motore, Turbo, Trasmissione, Gomme (con la mescola), Sospensioni, Telaio leggero; Gomme e Sospensioni danno anche MAN&nbsp; |
| **Moduli** | pezzi montati negli slot del mezzo (3.3) |
| **Armi** | un'arma per attacco: davanti, dietro, torretta (capitolo 7\) |
| **Mazzo** | quali Trucchi entrano nel mazzo del briefing (capitolo 8\) |
| **Carrozzeria** | colori, finiture, strisce, cerchi, adesivi, numero; vernici ed extra si comprano una volta per tutti i mezzi |

3.3 Moduli

Ogni modulo si compra una volta e si monta su qualsiasi mezzo; gli slot sono 2, 3 per i mezzi pesanti (`modules.HEAVY_MASS`), un modulo per tipo. Valori nel gruppo `modules`.

| Modulo | Effetto |
| :---- | :---- |
| Paraurti rinforzati | meno PF persi a ogni speronamento o contatto laterale forte&nbsp; |
| Speroni | bonus nel test di speronamento quando si attacca |
| Lame sui mozzi | il contatto laterale conta prima e costa all'altro più PF&nbsp; |
| Corazza | più RES, ma più massa e meno accelerazione&nbsp; |
| Caldaia maggiorata | più CAL&nbsp; |
| Valvole maggiorate | più AFF&nbsp; |
| Turbina | la caldaia genera vapore più in fretta da sola&nbsp; |

4\. Partenza

Una gara procede così: caricamento → **briefing** (capitolo 8\) → **conto alla rovescia** con la Prova di Partenza → VIA. Valori nel gruppo `start`.

- **posizione di Avviamento** (solo gara singola): ogni pilota parte nella griglia in una posizione causale. Nel Gran Premio la griglia segue la classifica.  
- **Prova di Partenza**: mentre si accendono le luci un indicatore mostra un ago che sale tenendo premuta la spinta a vapore e scende lasciandola. Bisogna tenerlo nella fascia verde (più larga con MAN alta e per il primo in griglia; la tolleranza sopra la fascia cresce con AFF).  
- **Esiti al VIA**, secondo quanto è rimasto l'ago nella fascia nell'ultimo secondo e mezzo:

| Esito | Cosa succede |
| :---- | :---- |
| Scatto perfetto | spinta a vapore lunga, \+1 Grinta, si parte in 3ª |
| Buona partenza | spinta a vapore breve, si parte in 2ª |
| Normale | si parte in 1ª |
| Stallo | ago a zero o in zona rossa al VIA: motore spento per un attimo |

- Le spinte della partenza sono gratis; i 2 PV dell'accensione restano in caldaia.  
- Dopo il VIA nessuno può dare spinte per qualche secondo e nessuno spara: la griglia non diventa un tiro al bersaglio.

## 5\. Guida, marce e caldaia

### 5.1 Guida a marce

Non c'è il gas: il mezzo va da solo alla velocità della marcia inserita, come al tavolo. Valori nel gruppo&nbsp;

- **Sei marce**, ognuna una frazione della velocità massima del mezzo (la 1ª circa un quinto, la 6ª tutta). La targhetta d'ottone nell'HUD mostra la marcia; 5ª e 6ª sono in rosso.  
- **Salire**: ogni spinta a vapore riuscita sale anche di una marcia; il suo PV paga il cambio. Senza vapore la spinta non parte e la marcia resta (doppio scatto della leva). In 6ª, o subito dopo un cambio, è solo spinta.  
- **Scalare**: premere freno scala di una marcia; dalla 4ª in su scalando si riprende 1 PV. La scalata frena.  
- **Frenare**: freno tenuto premuto frena davvero; da fermo è la retromarcia.  
- Il ritmo tipico: si sale nei rettilinei, si scala prima delle curve, si sbanda in curva (drift).  
- **Avviso curva**: poco prima di ogni curva, sopra il mezzo appare un cartellino con il tipo (larga, stretta, tornante, S), il verso, da uno a tre chevron di gravità e la marcia consigliata; se la marcia inserita è più alta, il numero lampeggia in rosso. La barra sotto si riempie avvicinandosi. Nelle S, entrati nella prima curva, mostra quella che segue. In pista, all'esterno delle curve strette ci sono tabelloni a chevron (due arancio; tre rossi nei tornanti); sulle tessere stampate del gioco da tavolo lo stesso segnale è dipinto sulla strada prima di ogni curva.  
- **Fondi**: sterrato, fango, guado, ghiaia, sabbia, pietraia, ghiaccio, asfalto, con aderenza diversa; pioggia e neve tolgono aderenza. Le gomme e la mescola cambiano la resa per fondo.  
- **Salti**: atterraggi puliti danno vapore e i salti lunghi danno Grinta.  
- **Riposiziona**: rimette il mezzo in pista se è bloccato o ribaltato.

### 5.2 Caldaia e Punti Vapore

La caldaia è la risorsa centrale. Valori nel gruppo `boiler`; il manometro dell'HUD va da 0 a 2 × CAL, con la metà destra rossa.

**Da dove arriva il vapore**

| Fonte |  |
| :---- | :---- |
| accensione in griglia |  |
| generazione passiva, sempre |  |
| atterraggio pulito dopo un salto |  |
| scia di un rivale ad alta velocità |  |
| scalata dalla 4ª in su |  |
| casse di carbone in pista |  |

**Dove va**: la spinta a vapore (1 PV per tocco: un'accelerazione extra per `n` secondi, con un'attesa `x` tra una spinta e l'altra), i cambi di marcia, il cannone a vapore, alcune carte.

**Zona rossa**: oltre CAL la caldaia si riempie di pressione (più lentamente con AFF alta). In zona rossa la spinta è più forte, ma quando la pressione è piena, o i PV arrivano a 2 × CAL, parte il **test di Affidabilità**: la caldaia va in **stallo**. Il cambio si blocca e i tasti marcia (su o giù, indifferente) diventano la leva della valvola. Sotto il mezzo compare un semicerchio a terra, sul lato rivolto alla telecamera: un ago lo percorre da sinistra a destra e bisogna premere un tasto marcia quando passa sulla tacca verde (più larga con AFF). Nei primissimi istanti del test i tasti marcia sono ignorati, così un cambio già partito non spreca il test. Durante lo stallo non si sale né si scala (niente PV restituiti), niente spinte; tenendo premuto giù si frena comunque. A test finito l'anello lampeggia verde o rosso.

| Situazione | Tacca presa | Tacca mancata |
| :---- | :---- | :---- |
| zona rossa | pressione contenuta, niente di male | valvole d'emergenza: PV a zero, −3 marce, 1 PF |
| 2 × CAL | le valvole cedono: PV a zero, frenata forte, 2 PF | **esplosione**: fermo per `STALL` s, CAL −2, niente generazione passiva, si torna in 1ª, metà dei PF massimi persi, onda d'urto sui vicini |

**Sfiato**: il tasto sfiato scarica vapore; la nuvola resta dietro il mezzo e allarga il cono di chi spara attraverso. Lo stesso tasto arma anche la Difesa Attiva (capitolo 7.3): l'ordine è difesa → sfiato. Durante il test di Affidabilità il tasto sfiato non fa nulla (la valvola si apre con i tasti marcia).

## 6\. Scocca, urti e barricate

### 6.1 Punti Ferita e relitti

Ogni mezzo ha 20 PF (riquadro Scocca nell'HUD). Sotto il 50 % il motore fuma, sotto il 25 % prende fuoco. A zero il mezzo è un **relitto**: resta fermo in pista come ostacolo, il pilota è ritirato (barrato in classifica). Se il giocatore diventa relitto, dopo qualche secondo si va ai risultati. Ogni gara riparte con i PF pieni.&nbsp;

6.2 Speronamento

Chi colpisce col muso fa un confronto come al tavolo: inerzia (massa e marcia), bonus se l'urto è perpendicolare, un piccolo dado per lato, Speroni. Lo scarto decide i PF persi; di solito ci rimettono tutti e due, ma chi vince l'urto meno. Un forte scarto spinge il bersaglio, e se finisce contro il muro perde 1 PF in più. Un mezzo che ne spinge un altro contro un terzo applica la regola della catena. I contatti di fianco veloci costano 1 PF (prima con le Lame). Vincere uno speronamento con un buon scarto dà Grinta.

### 6.3 Muri e barricate

Il bordo della pista è un muro di terra; sopra ogni tratto c'è un tipo di barricata, e conta quella. Valori nel gruppo `barricades`.

| Bordo | Effetto dell'urto |
| :---- | :---- |
| terra nuda | PF solo per colpi violenti; \+1 se spinti da uno speronamento |
| lamiere rivettate | PF già a urti medi, di più a quelli violenti |
| ricci cechi | come le lamiere, \+1 PF |
| lamiera ondulata | PF a urti medi |
| sacchi di sabbia | assorbono il colpo violento ma frenano lo strisciamento; la spinta conta ancora |
| filo spinato | niente PF, ma si perde una marcia e si viene frenati |

Le barricate non si rompono. Le IA stanno più lontane dai lati duri.

**Come funziona il bordo.** Il bordo è un muro invisibile e liscio: paletti, sacchi e ricci sono solo grafica, non ci si può incastrare. Ogni pezzo di pista ha un tipo di barricata per lato; il tipo decide la reazione e anche l'ambiente generato dietro (fonderia, depositi, sfasciacarrozze, postazione fortificata, terra brulla, terra di nessuno).

- **Strisciata**: si prosegue lungo il bordo ma sempre più lenti della traiettoria pulita (poco sulle lamiere rivettate, molto su ricci, sacchi e filo spinato).
- **Urto di striscio**: si perde velocità e il mezzo viene raddrizzato lungo il bordo.
- **Urto frontale**: schianto. Il mezzo si ferma e riparte in prima.
- Scintille (o polvere sui bordi morbidi) e tremolio dello schermo accompagnano ogni impatto; intensità nel gruppo `feedback`.
- I PF della tabella arrivano in M3, agganciati agli stessi eventi (urto, schianto, strisciata ogni tot).

## 7\. Armi e combattimento

### 7.1 Equipaggiamento

Tre attacchi per mezzo, un'arma per attacco, scelti nella scheda Armi del Garage. Cannone e olio sono gratis, le altre si comprano una volta con i Crediti. Valori nei gruppi `weapons` (cannone, olio, cono, casse) e `arsenal` (le altre).

| Attacco | Armi |
| :---- | :---- |
| Davanti | **Cannone** (danno base); **Lanciabulloni** (raffica, un bullone al centro fora una gomma); **Magnete** (nessun danno: tira il bersaglio e gli spegne la spinta); **Arpione** (catena che trascina, al centro fa girare) |
| Dietro | **Olio bollente** (chiazza che fa slittare e danneggia); **Mine a chiodi** (restano in pista, danno e foratura) |
| Torretta | **Cannone a vapore** (costa PV invece di munizioni, al centro spinge di lato); **Mortaio** (tiro ad arco previsto, danno ad area, vola sopra i relitti) |

La torretta, senza Artigliere (passo 8), spara solo in avanti agganciando il bersaglio come il cannone.

**Riscaldamento della caldaia.** Al VIA la caldaia è fredda e le armi sono bloccate. Si armano, per il resto della gara, la prima volta che si raggiunge la **6ª marcia** oppure alla fine del **primo giro**, quello che arriva prima. Il blocco vale per tutti, IA compresa. HUD: "COLD · GEAR 6 / LAP 2", poi l'avviso "BOILER HOT: WEAPONS ARMED!". Valori `weapons.unlockGear` e `weapons.unlockLap`.

### 7.2 Mira: il cono di dispersione

Il Test di Fuoco del tavolo diventa un cono. Le armi anteriori agganciano da sole il rivale davanti (mirino e spicchio di mira a terra); il colpo cade in un punto a caso nel cono.

- **Allargano** il cono: marce alte (dalla 5ª, di chi spara e del bersaglio), curve, manovre recenti, la nuvola di uno sfiato, il Blackout.  
- **Lo stringono**: la precisione dell'arma, tenere la linea per qualche istante, il Trucco "Polvere fine".

Dove il colpo attraversa la sagoma decide la **zona**: centro, vitale, corpo, bordo (solo scintille) o mancato. Vitale e centro fanno danno critico; al danno si toglie la RES del bersaglio e il bonus della difesa. Solo il colpo al centro applica l'effetto speciale dell'arma (per il cannone: −1 marcia) e dà Grinta a chi spara.

Le **casse di munizioni** in pista ricaricano; l'olio ha cariche limitate.

### 7.3 Grinta e Difesa Attiva

**Grinta** (0–5, si parte da 1; gruppo `grit`): si guadagna con sorpassi, salti lunghi, colpi al centro, speronamenti vinti, eliminazioni e lo scatto perfetto. Il riquadro armi la mostra con tacche parziali.

**Difesa Attiva**: quando un rivale ha agganciato il giocatore compare l'avviso "sotto tiro" con una freccia. Premendo sfiato durante l'avviso la difesa si arma; se il colpo arriva mentre è armata costa 1 Grinta e aggiunge un bonus alla RES (metà di un d10). Armata all'ultimo istante prima dell'impatto il bonus è massimo. Se il colpo non arriva la Grinta non si spende.

## 8\. Carte

Tre livelli, tutti nel gruppo `cards` di `rules.js`.

### 8.1 Briefing: i Trucchi

Prima del semaforo si pescano 3 Trucchi dal proprio mazzo e se ne sceglie 1, che vale per tutta la gara (in 2 giocatori ognuno sceglie nella sua colonna). Il mazzo si compone nella scheda Mazzo del Garage (da 3 a 10 carte).

| Trucco | Effetto |
| :---- | :---- |
| Caldaia lucidata | \+1 CAL |
| Carbone di Iron City | più generazione passiva di vapore |
| Partenza truccata | fascia verde della Prova di Partenza più larga |
| Corazza di fortuna | \+2 PF |
| Polvere fine | cono del cannone più stretto |
| Pubblico comprato | la Grinta si ricarica più in fretta |
| Sponsor nanico | \+20 % di Crediti se si arriva senza perdere PF |

### 8.2 Mano in gara

Tre caselle. Le carte arrivano a ogni giro completato, dal pubblico dopo una bella giocata (colpo al centro, scatto perfetto, speronamento vinto, eliminazione) e dalle casse delle carte. Si giocano pagando PV o Grinta; le carte che non si possono pagare sono attenuate, quelle ostili sono in rosso.

| Carta | Effetto |
| :---- | :---- |
| Saldatura al volo | ripara qualche PF |
| Valvola forzata | gratis: PV in più oltre il limite della caldaia (rischio di zona rossa) |
| Munizioni dal pubblico | ricarica le armi |
| Fuga di vapore | una nuvola di vapore dietro di sé che allarga il cono di chi insegue |
| Sabotaggio | ostile: manda in zona rossa la caldaia del mezzo davanti |
| Blackout | ostile: i rivali vicini davanti perdono l'aggancio, cono al massimo |
| Agente imperiale | annulla la prossima carta ostile giocata contro di sé |

Le IA giocano le loro carte con le stesse regole.

### 8.3 Eventi di gara

Con l'opzione "Eventi di gara" attiva, all'inizio di una gara può uscire un evento che cambia le regole per tutti:

| Evento | Effetto |
| :---- | :---- |
| Caldaie surriscaldate | −1 CAL a tutti |
| Pista scivolosa | meno aderenza per tutti |
| Pubblico generoso | ogni bella giocata vale una carta, le casse ne danno due |
| Carbone a buon mercato | il doppio delle casse di carbone |

9\. In pista: casse, HUD e fine gara

### 9.1 Casse in pista

| Cassa | Cosa dà |
| :---- | :---- |
| Carbone | PV&nbsp; |
| Munizioni | ricarica delle armi |
| Carte | una carta in mano (due con Pubblico generoso) |
| Sacco di soldi | 5.000 \$ per l'Officina del Gran Premio |

9.2 HUD

- In alto a sinistra: posizione e giro, poi la striscia con Scocca (PF), armi (colpi, olio, torretta, Grinta), manometro della caldaia, soldi e targhetta della marcia.  
- In alto a destra: minimappa e classifica (compatta sui telefoni).  
- Sopra il tachimetro: la mano di carte; in alto l'evento di gara.  
- Al centro, quando serve: indicatore della Prova di Partenza, mirino, avviso "sotto tiro", banner degli esiti.  
- Sul mezzo: sotto, marcia e Punti Vapore; sopra, l'avviso della prossima curva (sui telefoni, se in alto non c'è spazio, scende sotto la marcia).

### 9.3 Fine gara

Tre giri; i risultati mostrano posizione, tempi, giro migliore, premi, ritirati e costo di riparazione. Nel Gran Premio seguono la classifica della Coppa e l'Officina; nella gara singola si torna al titolo. Poi i Crediti guadagnati e i trofei sbloccati.

## 10\. Scuola guida

Un circuito con l'istruttore, senza rivali; le lezioni ricaricano la caldaia da sole. Un concetto per lezione; alcune partono quando arriva la situazione giusta (una curva, un salto, il relitto, le barricate). Paga i Crediti una volta.

| Sezione | Lezioni |
| :---- | :---- |
| Prima del VIA | Briefing, Partenza |
| Guida (senza armi) | Accelera, Sterza, Marce, Curve (leggere l'avviso sopra il mezzo e scalare alla marcia consigliata), Drift, Spinta a vapore, Zona rossa (stallo caldaia e sfiato), Salto, Urti e PF (relitto parcheggiato), Barricate, Speroni, Riposiziona, Telecamera |
| Fuoco | Riscaldamento (armi fredde finché non si sale in 6ª o si chiude un giro: l'istruttore lo spiega e chiede di salire in 6ª per armarle), Cannone (sul relitto), Olio, Torretta, Difesa (il relitto spara a salve), Carte, Eventi |
| Fine | guida libera fino al traguardo |

Fuori dalla Scuola le carte sono sempre attive e le armi seguono il riscaldamento della caldaia (§7.1). Anche nelle altre modalità compaiono suggerimenti contestuali, una volta sola.

&nbsp;

## Appendice: comandi

| Azione | Giocatore 1 (tastiera) | Giocatore 2 (tastiera) | Gamepad |
| :---- | :---- | :---- | :---- |
| Sterza | ← → | A D | levetta sinistra |
| Spinta a vapore e sali di marcia · stallo caldaia: valvola | &nbsp;↑&nbsp; | W | A |
| Scala (tenuto: freno, retromarcia) · stallo caldaia: valvola | ↓ | S | LT |
| Sfiato · difesa | `/` (il tasto `-` sulla tastiera italiana) / Num 0 | Q | B |
| Arma anteriore | Ctrl destro / `.` | X | RB |
| Arma posteriore | Fine | Z | LB |
| Torretta | Canc | V | Y |
| Carte della mano (1, 2, 3\) | Ins / Home / PagSu | 1 / 2 / 3 | croce ↑ / ← / → |
| Riposiziona | Backspace / R | E | Back tenuto |

Sul touch: pad sinistro per sterzare, pulsante vapore grande, pedale "Marcia −" (tenuto: freno), pulsanti per sfiato, armi e carte. La pagina Comandi del gioco mostra i tasti aggiornati.