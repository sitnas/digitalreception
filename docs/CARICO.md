# Test di carico

Ottobre 2026. Script e istruzioni per ripeterlo in `load/`.

## In breve

- Una replica dell'API regge circa **400 verifiche al secondo ai lettori delle porte**, 700 richieste al secondo dalle app dei dipendenti e 165 check-in al secondo ai tablet, senza errori. Il picco del mattino di un'organizzazione da 3.000 dipendenti (tutti che entrano in mezz'ora) vale meno di 2 verifiche al secondo.
- Con **due repliche** il throughput sale del 40-75% su quasi tutti gli scenari. Il collo di bottiglia è la CPU dell'API: ogni replica usa un core, quindi si scala aggiungendo repliche.
- Il test ha trovato **due bug di concorrenza**, entrambi corretti e coperti da test. Il più grave bloccava l'intera API, per tutti i clienti, con una ventina di check-in contemporanei. Ha trovato anche due query lente nella dashboard, corrette con un indice e una cache.

## Ambiente

| | |
|---|---|
| Macchina | container Linux, 4 core, 15 GB di RAM, condivisi tra API, database, bilanciatore e generatore di carico |
| API | Node 22, `NODE_ENV=production`, pool di 10 connessioni (`DB_POOL_SIZE`, valore predefinito) |
| Database | MariaDB 10.11, configurazione predefinita: buffer pool di 128 MB |
| Due repliche | nginx davanti a due processi API, `THROTTLE_STORE=database` come in [OPERAZIONI.md](OPERAZIONI.md#più-repliche) |

Tutto gira sulla stessa macchina, quindi i numeri sono un **limite inferiore**. Con il database su un server suo e un buffer pool dimensionato sui dati, le query della console scendono ancora.

## Dati

Creati da `load/seed.mjs` attraverso le API vere (login, tablet abbinati, API HR, attivazione dei badge, check-in con firma), poi spalmati nel tempo con SQL:

| | Grande | Piccole (×4) | Totale |
|---|---|---|---|
| Sedi | 4 | 1 | 8 |
| Dipendenti con badge sul telefono | 3.000 | 200 | 3.800 |
| Porte e lettori | 20 | 2 | 28 |
| Tablet | 8 | 1 | 12 |
| Visite negli ultimi 60 giorni (firma da 25 KB) | 8.000 | 1.000 | 12.000 |
| Passaggi alle porte negli ultimi 60 giorni | 216.000 | 14.000 | 272.000 |
| Pacchi | | | 320 |

Il traffico è diviso tra le organizzazioni in proporzione alle dimensioni: quella grande ne riceve circa l'80%. Ogni richiesta arriva da un indirizzo diverso, come tanti dispositivi.

## Scenari

| Scenario | Cosa simula | Richiesta |
|---|---|---|
| doors | ingressi del mattino: il lettore verifica il QR del telefono e registra il passaggio | `POST /api/reader/verify` |
| checkin | ospite al tablet, con firma | `POST /api/kiosk/visits` |
| console | reception e responsabili: chi è presente, dashboard, pacchi | `GET /api/admin/...` |
| app | app dei dipendenti in primo piano: profilo e pacchi | `GET /api/me`, `/api/me/parcels` |
| hr | il gestionale HR aggiorna i dipendenti, con i permessi alle porte | `PUT /api/integration/v1/employees/:id` |
| mixed | tutto insieme: porte 50%, app 30%, console 10%, check-in 5%, HR 5% | |

Ogni scenario gira 20 secondi a 10, 50 e 100 connessioni contemporanee. Una connessione manda la richiesta successiva appena riceve la risposta: 100 connessioni equivalgono a migliaia di dispositivi reali, che aspettano secondi tra una richiesta e l'altra.

## Risultati

Richieste riuscite al secondo e latenze in millisecondi. Errori: zero in tutte le prove, tranne una connessione chiusa all'avvio di una prova con due repliche.

### Una replica

| Scenario | Conn. | req/s | p50 | p90 | p99 | CPU API / DB |
|---|---|---|---|---|---|---|
| doors | 10 | 400 | 24 | 31 | 39 | 101% / 57% |
| doors | 100 | 404 | 237 | 307 | 352 | 103% / 55% |
| checkin | 10 | 175 | 54 | 71 | 93 | 102% / 96% |
| checkin | 100 | 156 | 620 | 701 | 801 | 99% / 141% |
| console | 10 | 199 | 37 | 104 | 138 | 99% / 164% |
| console | 100 | 182 | 448 | 926 | 1.056 | 100% / 157% |
| app | 10 | 686 | 13 | 18 | 25 | 99% / 56% |
| app | 100 | 721 | 133 | 163 | 197 | 104% / 55% |
| hr | 10 | 334 | 28 | 37 | 49 | 101% / 69% |
| hr | 100 | 351 | 278 | 319 | 362 | 103% / 67% |
| mixed | 10 | 374 | 23 | 39 | 84 | 103% / 80% |
| mixed | 50 | 344 | 146 | 188 | 314 | 102% / 77% |
| mixed | 100 | 277 | 355 | 503 | 771 | 103% / 76% |

L'API è sempre al 100% di un core: il throughput non sale oltre le 10 connessioni, cresce solo la coda. Il database lavora a metà.

### Due repliche

| Scenario | Conn. | req/s | p50 | p90 | p99 | vs una replica |
|---|---|---|---|---|---|---|
| doors | 50 | 698 | 68 | 129 | 159 | +75% |
| checkin | 50 | 241 | 208 | 335 | 399 | +48% |
| console | 100 | 314 | 276 | 630 | 928 | +73% |
| app | 100 | 1.060 | 92 | 180 | 210 | +47% |
| hr | 50 | 534 | 87 | 175 | 218 | +63% |
| mixed | 50 | 515 | 90 | 175 | 270 | +50% |
| mixed | 100 | 429 | 186 | 423 | 1.849 | +55% |

Con due repliche, bilanciatore, database e generatore di carico sui 4 core, la macchina è satura: su hardware separato il guadagno sarebbe più vicino al doppio. Nel check-in e nello scenario misto a 100 connessioni il database arriva a 1,5-2,3 core: è il prossimo limite dopo la CPU dell'API.

## Problemi trovati e corretti

**Check-in: l'API si bloccava per tutti (critico).** Il check-in apriva una transazione, che tiene una connessione del pool, e al suo interno chiedeva una *seconda* connessione per generare il codice della visita. Con 10 check-in contemporanei (tanti quante le connessioni del pool) ognuno aspettava una connessione che nessuno avrebbe liberato. L'API smetteva di rispondere a ogni richiesta, di ogni organizzazione, `/api/health` compreso, e non ripartiva da sola. Ora il codice viene generato prima della transazione. Un test e2e manda 40 check-in insieme: falliva prima della correzione, passa dopo. Ho controllato le altre transazioni del codice: nessuna aveva lo stesso schema.

**Aggiornamenti HR: deadlock.** Aggiornamenti contemporanei di dipendenti diversi andavano in deadlock sul database (errore 1213) e il gestionale riceveva un 500. Ora la transazione viene ripetuta fino a tre volte con un'attesa casuale, i permessi si scrivono con un solo insert e per un dipendente nuovo non si cancella nulla. Zero errori su oltre 30.000 aggiornamenti.

**Dashboard: conteggi dei passaggi lenti.** I numeri delle porte (oggi, stesso giorno della settimana scorsa, rifiutati della settimana) leggevano tutti i passaggi della sede: 2 secondi con questi dati. Un indice su (organizzazione, sede, esito, ora) e quattro conteggi su intervalli esatti li portano a pochi millisecondi. Al picco, però, i lettori scrivono proprio nell'intervallo che la dashboard legge e il conteggio tornava a 2-5 secondi. I conteggi delle porte ora restano in memoria un minuto per organizzazione e insieme di sedi. Con due repliche lo scenario misto a 100 connessioni è passato da 194 a 429 req/s.

**Dashboard: visite.** Le somme per giorno selezionavano tutte le colonne della visita, impedendo al database di rispondere dal solo indice. Corretto. La dashboard completa dell'organizzazione grande risponde in 27 ms a riposo.

## Limiti noti

- **La lista dei presenti cresce con i presenti**: circa 0,13 ms per ospite in sede, quindi 280 ms con 2.000 ospiti contemporaneamente in una sede. Va bene per qualunque reception reale.
- **Una replica usa un core.** Per sfruttare una macchina con più core servono più repliche dietro un bilanciatore, anche sulla stessa macchina.
- **Il database con la configurazione predefinita** (buffer pool di 128 MB) regge questi volumi. In produzione va dimensionato sui dati: indicativamente il 50-70% della RAM di un server dedicato.
- Lo scenario console chiede la dashboard una volta su quattro. Nella realtà la dashboard si carica quando si apre la pagina e non si aggiorna da sola, quindi pesa molto meno.
- Non è stato misurato: invio di email e notifiche push (girano in background, fuori dal percorso della richiesta), storage S3, latenza di rete reale tra dispositivi e server.

## Dimensionamento indicativo

Il carico reale è fatto di picchi brevi: ingressi del mattino, pausa pranzo, uscite.

| Installazione | Picco atteso | Consiglio |
|---|---|---|
| Fino a 2.000 dipendenti, qualche sede | meno di 5 req/s | 1 replica, 1-2 vCPU, database sulla stessa macchina |
| 2.000-20.000 dipendenti, decine di sedi | 10-40 req/s | 2 repliche (alta disponibilità più che capacità), database su un server suo |
| SaaS con molte organizzazioni | centinaia di req/s | 1 replica ogni 300 req/s di picco con margine del 50%, database dedicato con buffer pool adeguato, `THROTTLE_STORE=database` |

Il conto del picco: 3.000 dipendenti che entrano tra le 8:30 e le 9:00, con un passaggio ciascuno, fanno 1,7 verifiche al secondo. Una replica ne regge 400.

## Ripetere il test

Su una macchina di prova, **mai sul database di produzione**: il seed crea organizzazioni e migliaia di righe.

```bash
# 1. Un database vuoto e l'API avviata su di esso, con TENANCY_MODE=subdomain e BASE_DOMAIN=load.test
cd load && npm ci

# 2. I dati (circa 2 minuti). LOAD_ENV è il file di variabili dell'API: lo usa per creare le organizzazioni con la CLI
LOAD_ENV=../api/.env.load node seed.mjs

# 3. Gli scenari; LOAD_PIDS aggiunge la CPU usata da questi processi (API, database)
LOAD_PIDS=<pid api>,<pid mariadbd> node run.mjs
LOAD_CONNECTIONS=25,100 LOAD_DURATION=30 node run.mjs doors mixed

# Contro un bilanciatore con più repliche
LOAD_API=http://127.0.0.1:8080 node run.mjs
```

I risultati vanno in `load/.out/` (escluso da git). Il generatore manda un `X-Forwarded-For` diverso per ogni richiesta: l'API deve fidarsi del proxy (`TRUST_PROXY=1`), altrimenti i limiti di tentativi per indirizzo fermano il test. Lo scenario `checkin` lascia in sede migliaia di ospiti e la lista dei presenti cresce con loro: per questo gira per ultimo.
