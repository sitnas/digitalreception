# Accessi dipendenti

Il sistema esterno dell'azienda, per esempio il gestionale HR o il controllo accessi, invia all'app dipendenti, porte e permessi. Ogni dipendente si identifica alla porta in due modi:

- con un **QR sul telefono**, nella pagina "Il mio badge", che cambia ogni 30 secondi;
- con una **tessera NFC**.

Il lettore alla porta è un tablet o telefono Android. Verifica chi è e se può entrare, mostra **verde o rosso** e registra il passaggio.

> Versione attuale: la porta **non viene aperta** automaticamente. Il lettore mostra solo l'esito. Il comando di una serratura (relè o sistema accessi esistente) è un passo successivo.

## Prima di metterlo in uso: obblighi di legge (Italia)

Registrare gli ingressi dei dipendenti è un **controllo a distanza** ai sensi dell'**art. 4 dello Statuto dei Lavoratori** (L. 300/1970).

- **Autorizzazione**: prima dell'uso serve un **accordo con le RSA/RSU** oppure l'**autorizzazione dell'Ispettorato Territoriale del Lavoro**.
- **Informativa e DPIA**: i dipendenti vanno informati (art. 13 GDPR). Serve anche una **valutazione d'impatto** (DPIA), perché si tratta di un trattamento sistematico di dati di lavoratori.
- **Scopo dei dati**: i dati servono alla sicurezza degli accessi. Non vanno usati per la rilevazione presenze o per fini disciplinari, a meno che non sia previsto dall'accordo e dall'informativa.

L'app è progettata per ridurre i dati al minimo:

- nessuna geolocalizzazione;
- nessuna foto;
- il registro dei passaggi viene cancellato dopo **90 giorni** (variabile `ACCESS_LOG_RETENTION_DAYS`);
- il lettore mostra solo nome e iniziale;
- il registro lo vedono solo Amministratore, Responsabile di sede (per le sue sedi) e Auditor;
- la reception non vede il registro, ma in **Risultano dentro** vede chi è dentro adesso nelle sue sedi, con reparto, ora e porta dell'ultimo ingresso di oggi (vedi *Segnare un'uscita dalla console*);
- ogni consultazione finisce nel registro accessi della console.

## Come si configura

1. **Console → Integrazione API → Crea chiave.** La chiave (`drk_…`) si vede una volta sola: va consegnata al fornitore del sistema esterno. Si può revocare in qualsiasi momento.
2. **Porte.** Il sistema esterno le crea con l'API, oppure le crea l'amministratore in **Console → Porte e lettori**. Ogni porta ha un **codice esterno**, lo stesso usato dal sistema esterno, e una **direzione** che serve solo all'anti-passback (vedi *Anti-passback*).
3. **Lettori.** In **Porte e lettori → Associa lettore** si ottiene un codice di 8 caratteri. Sul tablet o telefono Android alla porta si apre `https://<indirizzo>/reader`, si inserisce il codice e il lettore resta associato a quella porta.
   - **QR**: il lettore usa la fotocamera frontale.
   - **Tessere NFC**: su Chrome per Android si tocca una volta "Attiva tessere NFC". In alternativa si collega un lettore NFC USB che funziona come tastiera.
4. **Dipendenti.** Il sistema esterno li invia con l'API, oppure l'amministratore li aggiunge a mano in **Console → Dipendenti → Nuovo dipendente**. Vedi sotto, *Dipendenti a mano*. Ognuno attiva il badge sul telefono dalla pagina `https://<indirizzo>/badge`: inserisce l'email di lavoro, riceve un codice di 6 cifre e lo digita. Serve l'invio email attivo (vedi Organizzazione).

## Installare i lettori su dispositivi fisici

### Tablet o telefono Android alla porta (con schermo)

1. **Scegli il dispositivo.**
   - Un tablet Android da 8–10", oppure un telefono, con **NFC** se si usano le tessere.
   - La fotocamera frontale serve per il QR.
   - Va alimentato **sempre dalla corrente**: un supporto a muro con cavo, all'altezza di 110–120 cm.
2. **Abbinalo alla porta.**
   - In console: **Porte e lettori → Associa lettore**.
   - Sul dispositivo apri Chrome su `https://<indirizzo>/reader`, inserisci il codice e concedi fotocamera e NFC.
3. **Installalo come app.** Dal menu di Chrome scegli **"Installa app"** o **"Aggiungi a schermata Home"**.
   - L'icona "Lettore" si apre direttamente a tutto schermo sulla pagina del lettore, senza barra del browser.
   - Mentre è aperta, lo schermo resta acceso.
4. **Bloccalo sull'app**, così chi passa non può uscire:
   - **semplice**: Impostazioni → Sicurezza → **Blocco app sullo schermo** (o "Fissa app"), poi fissa il Lettore;
   - **professionale** (più dispositivi): un browser kiosk come **Fully Kiosk Browser**, oppure una gestione MDM (Android Enterprise, modalità "dedicated device"). Aprono il lettore all'accensione, impediscono di uscire e riavviano l'app se si chiude.
5. **Impostazioni del dispositivo.**
   - Spegnimento schermo "mai" o il massimo possibile.
   - Aggiornamenti automatici di notte.
   - Wi-Fi aziendale stabile.
   - Luminosità alta per leggere bene il QR.

**Da solo, il lettore:**
- si collega al server ogni minuto;
- si ricarica una volta al giorno, alle 3 di notte, per usare sempre l'ultima versione;
- se perde la rete mostra "Nessuna connessione" e riprova da solo.

In console, in **Porte e lettori**, ogni lettore appare **In linea** oppure **Non raggiungibile dalle…**: così ci si accorge subito se un dispositivo si spegne o perde il Wi-Fi.

### Lettore senza schermo (Raspberry Pi, mini PC, controller)

Un dispositivo senza schermo può fare da lettore chiamando direttamente l'API dei lettori. È l'hardware tipico, per esempio:
- un **Raspberry Pi** con un lettore NFC USB e, in seguito, un relè per la serratura;
- un controller di accesso che supporti richieste HTTPS.

| Metodo | Percorso | Cosa fa |
|---|---|---|
| `POST` | `/api/reader/pair` | Corpo `{"code":"ABCD2345"}` (codice da "Associa lettore"). Risponde `{"readerToken":"…"}`, da conservare sul dispositivo. |
| `POST` | `/api/reader/verify` | Con `Authorization: Bearer <readerToken>`. Corpo `{"nfc":"04A21B9C"}` oppure `{"qr":"DRE1:…"}`. Risponde `{"result":"GRANTED"\|"DENIED","reason":"…","name":"Mario R.","door":"…"}` e registra il passaggio. |
| `GET` | `/api/reader/config` | Con lo stesso token: nome della porta e della sede. Chiamarlo ogni minuto fa da "segnale di vita" per lo stato In linea in console. |

L'indirizzo è quello dell'organizzazione, lo stesso della console. Il token vale solo per quella porta: se il dispositivo viene rubato basta **Scollega** in console.

Esempio minimo in Python: un lettore NFC USB "a tastiera" scrive l'UID e preme Invio, lo script lo verifica e (quando ci sarà il relè) apre la porta.

```python
import requests, time

BASE = "https://<indirizzo>"
TOKEN = open("/etc/lettore/token").read().strip()   # ottenuto una volta con /api/reader/pair
H = {"Authorization": f"Bearer {TOKEN}"}

while True:
    uid = input().strip()                  # il lettore USB "digita" l'UID e preme Invio
    if not uid:
        continue
    try:
        r = requests.post(f"{BASE}/api/reader/verify", json={"nfc": uid}, headers=H, timeout=5).json()
    except requests.RequestException:
        print("Nessuna connessione"); continue
    if r["result"] == "GRANTED":
        print("Consentito", r.get("name"))
        # relay.on(); time.sleep(3); relay.off()   # es. gpiozero.OutputDevice(17) per il relè
    else:
        print("Negato:", r["reason"])
```

Per il segnale di vita basta un secondo processo (o un cron) che chiami `GET /api/reader/config` ogni minuto.

## API per il sistema esterno

Indirizzo base: `https://<indirizzo>/api/integration/v1`. Ogni richiesta porta l'intestazione `Authorization: Bearer drk_…`.

Regole generali:

- I codici (`id`) sono quelli del sistema esterno: lettere, numeri e `. _ : @ -`, fino a 100 caratteri.
- `PUT` crea o **sostituisce** il record intero, permessi compresi. Si può ripetere senza creare doppioni: il modo più semplice è rimandare ogni dipendente quando cambia.
- Limite: 600 richieste al minuto.

| Metodo | Percorso | Cosa fa |
|---|---|---|
| `PUT` | `/doors/{id}` | Crea o aggiorna una porta. Corpo: `siteCode` (codice della sede in console), `name`, `active`, `direction` e `antiPassback` (gli ultimi tre facoltativi; vedi sotto). |
| `PUT` | `/projects/{codice}` | Crea o aggiorna una commessa. Corpo: `name`, `client` (facoltativo), `active` (facoltativo; `false` la chiude). |
| `PUT` | `/employees/{id}` | Crea o aggiorna un dipendente e i suoi permessi (vedi sotto). |
| `DELETE` | `/employees/{id}` | Cancella il dipendente e i permessi; il registro perde il collegamento alla persona. |

Corpo di `PUT /doors/{id}`:

```json
{
  "siteCode": "MI",
  "name": "Ingresso principale",
  "active": true,
  "direction": "IN",
  "antiPassback": true
}
```

- **`active`**: se manca, la porta è attiva.
- **`direction`**: `NONE`, `IN` (ingresso) o `OUT` (uscita). Qui il `PUT` non sostituisce tutto: se il campo manca, la porta tiene la direzione che ha, anche se l'ha cambiata qualcuno dalla console. Una porta nuova parte da `NONE`.
- **`antiPassback`**: `true` o `false`, solo con la direzione `IN` (vedi *Anti-passback*, più sotto). Se manca resta com'è, con un'eccezione: passando da `IN` a un'altra direzione si spegne da solo.
- **Errori**: `400 UNKNOWN_SITE`; `400 ANTI_PASSBACK_IN_ONLY` se l'anti-passback resterebbe acceso su una porta che non è `IN`, per esempio `{"direction": "OUT", "antiPassback": true}`, oppure `{"antiPassback": true}` su una porta che è già `OUT`. Una richiesta rifiutata non cambia niente.

Corpo di `PUT /employees/{id}`:

```json
{
  "firstName": "Mario",
  "lastName": "Rossi",
  "email": "mario.rossi@azienda.it",
  "department": "Acquisti",
  "jobTitle": "Buyer",
  "badgeUid": "04:A2:1B:9C",
  "project": "C24-017",
  "active": true,
  "validFrom": "2026-10-01T00:00:00Z",
  "validUntil": null,
  "permissions": [
    { "door": "MI-MAIN" },
    { "door": "MI-LAB", "days": [1, 2, 3, 4, 5], "from": "08:00", "to": "19:00" }
  ]
}
```

Campi:

- **`email`**: serve per attivare il badge sul telefono.
- **`department` / `jobTitle`** (facoltativi): reparto e ruolo. Servono quando il dipendente è anche tra le *persone da visitare*, perché il tablet li mostra accanto al nome.
- **`project`** (facoltativo): il codice della commessa su cui lavora il dipendente, che deve esistere già (in console o con `PUT /projects/{codice}`), altrimenti la risposta è `400 UNKNOWN_PROJECT`. Se il campo manca, la commessa resta quella impostata, anche a mano dalla console; `null` la toglie. In console la commessa compare nella scheda del dipendente e si possono filtrare Dipendenti e Passaggi per commessa.
- **`badgeUid`**: il codice UID della tessera NFC. Sono ammessi i separatori `:`, `-` e gli spazi.
  - `null` rimuove la tessera; se il campo manca, la tessera resta com'è.
  - Una tessera può appartenere a un solo dipendente: altrimenti la risposta è `409 BADGE_IN_USE`.
- **`validFrom` / `validUntil`**: il periodo di validità (es. un contratto a termine).
- **`permissions`**: una voce per porta.
  - `days` va da 1 (lunedì) a 7 (domenica); se manca, vale tutti i giorni.
  - `from`/`to` sono in ora locale della **sede della porta**. Una fascia come 22:00–06:00 attraversa la mezzanotte. Se mancano, vale tutto il giorno.
- **Errori**:
  - `400 UNKNOWN_DOOR`, con l'elenco delle porte sconosciute;
  - `400 UNKNOWN_SITE`;
  - `401 API_KEY_INVALID`.

L'API **riceve soltanto**: non esistono chiamate per leggere dipendenti, porte o passaggi. Le risposte contengono solo il codice inviato e l'esito (`created`, `deleted`). I passaggi si consultano in console, alla voce Passaggi.

### Dati di prova: il gestionale finto

Per provare tutto senza un gestionale vero c'è un comando che inventa dipendenti realistici: nomi italiani, email, reparto e ruolo, metà con tessera NFC. Li manda alla stessa API come farebbe un gestionale HR. Serve una chiave creata in **Integrazione API**.

```bash
docker compose exec api npm run fake-employees -- --key drk_… --count 20 --site MI --domain azienda.it \
  --my-email tua.email@azienda.it --my-name "Nome Cognome"
```

- `--site` crea anche due porte in quella sede, *Ingresso principale* (lun–ven 7–20 per tutti) e *Magazzino* (solo logistica e produzione), con i permessi.
- `--my-email` dà il tuo indirizzo al primo dipendente, così puoi attivare l'app sul tuo telefono e provare gli inviti.
- Rilanciato, aggiorna le stesse persone senza creare doppioni. `--seed` cambia il gruppo di persone; `--remove` le cancella.
- In GitHub Codespaces usa `docker compose -f docker-compose.codespaces.yml exec api …`.

Motivi di rifiuto mostrati dal lettore e in console (`reason`):

| Codice | Significato |
|---|---|
| `UNKNOWN_CREDENTIAL` | Credenziale non riconosciuta |
| `QR_INVALID` | QR non valido |
| `QR_EXPIRED` | QR scaduto, tipicamente una foto o uno screenshot |
| `QR_USED` | Lo stesso codice ha già aperto questa porta; il lettore dice di aspettare il codice nuovo sul telefono |
| `EMPLOYEE_INACTIVE` | Dipendente non attivo |
| `APP_DISABLED` | Porte non attive per questa persona: sono spente nella sua scheda, in "App per questa persona" |
| `NOT_YET_VALID` | Periodo di validità non ancora iniziato |
| `EXPIRED` | Periodo di validità terminato |
| `DOOR_INACTIVE` | Porta disattivata |
| `NO_PERMISSION` | Nessun permesso per quella porta. Su una porta di Uscita: nessun permesso su nessuna porta attiva della sede |
| `OUTSIDE_SCHEDULE` | Fuori dai giorni o dagli orari consentiti. Mai sulle porte di Uscita |
| `ANTI_PASSBACK` | Risulta già dentro: oggi è entrato in questa sede e non è ancora passato da una porta di uscita, né la reception l'ha segnato come uscito. Solo sulle porte di ingresso con l'anti-passback; il lettore dice di chiedere alla reception |

Un passaggio concesso ha `reason` uguale a `OK`, con un'eccezione: l'uscita segnata dalla console ha `MARKED_OUT` (vedi *Segnare un'uscita dalla console*). Il lettore non la riceve mai, perché non passa da una porta.

## Dipendenti a mano

Senza un gestionale, o per qualcuno che il gestionale non conosce (un consulente, uno stagista), l'amministratore (SUPER_ADMIN) gestisce i dipendenti dalla console:

- **Dipendenti → Nuovo dipendente**: nome, cognome, email, reparto e ruolo, la tessera NFC (UID) se c'è, il periodo di validità. Poi le porte, ognuna con i giorni e l'orario. Nessun giorno scelto vuol dire tutti i giorni; nessun orario, a qualsiasi ora.
- Il **codice esterno** è facoltativo: se resta vuoto ne viene generato uno (`MAN-…`). Se in futuro colleghi un gestionale, conviene usare il codice che ha lui.
- **Modifica** su ogni riga apre lo stesso modulo. Il campo tessera vuoto lascia quella attuale; *Togli la tessera* la rimuove. Da lì si può anche eliminare il dipendente: perde porte, tessera e badge sul telefono, mentre i passaggi registrati restano senza nome.
- Le regole sono quelle dell'API: una tessera e un'email appartengono a una persona sola.

In elenco i dipendenti creati in console hanno l'etichetta "a mano". Vale l'ultimo che scrive: se il gestionale invia lo stesso codice esterno, sovrascrive il record, che da quel momento torna suo. Per questo modificando un dipendente arrivato dall'API la console avvisa che il prossimo invio annullerà le modifiche.

## Attivare il badge con l'account aziendale

Se l'organizzazione ha collegato Microsoft o Google (**Organizzazione → Accesso con l'account aziendale**), nell'app *Il mio badge* compare **Accedi con Microsoft** (o Google) subito dopo l'indirizzo dell'organizzazione. Il dipendente entra con l'account di lavoro nel browser del telefono e il badge si attiva, senza codice via email. Il codice via email resta disponibile come alternativa.

Lo stesso pulsante c'è sulla pagina web `/badge`: dopo Microsoft o Google il browser torna su `/badge` dello stesso indirizzo e il badge si attiva. La pagina web ha le stesse schermate dell'app (badge con l'anello del tempo, inviti per giorno, notifiche), con gli stessi testi.

- Il server accetta solo account della directory collegata (tenant Microsoft o dominio Workspace) e cerca il dipendente con **la stessa email**: chi non è tra i dipendenti riceve "non risulta tra i dipendenti".
- Il ritorno nell'app è protetto come nelle app bancarie (PKCE): l'app tiene un segreto e manda solo la sua impronta. Un'altra app che intercettasse l'indirizzo `drbadge://` non potrebbe usare il codice. Sulla pagina web il segreto resta nella scheda del browser che ha iniziato l'accesso, e il server rimanda solo a `/badge` dell'organizzazione, mai a un indirizzo esterno.
- Non serve registrare nulla di nuovo presso Microsoft o Google: si usa lo stesso indirizzo di ritorno della console.
- Come con il codice, attivare il badge su un telefono nuovo disattiva quello vecchio.

## Come funziona il QR sul telefono

- **Attivazione**: dopo il codice via email il server genera un segreto casuale di 32 byte. Lo salva cifrato con la chiave dell'organizzazione e lo consegna una sola volta al telefono.
- **Generazione del QR**: il telefono calcola ogni 30 secondi `DRE1:<id>.<passo>.<firma>`, dove la firma è un HMAC-SHA256 del passo temporale. Il QR si genera anche senza connessione.
- **Verifica**: il server accetta il passo corrente, il precedente e il successivo, quindi un codice resta valido per circa 90 secondi; i codici più vecchi li rifiuta come `QR_EXPIRED`.
- **Un codice, una volta per porta**: ogni coppia dipendente e passo apre ciascuna porta una sola volta, e il secondo uso sulla stessa porta riceve `QR_USED`. Vale anche per il codice che l'app Android trasmette via NFC, con più lettori sulla stessa porta e con più repliche dell'API, perché decide un vincolo UNIQUE nella tabella `access_qr_uses`. Consuma il codice solo un accesso concesso: un rifiuto per permesso o orario lo lascia valido. Finché è valido, lo stesso codice apre ancora un'altra porta per cui la persona ha il permesso. Il job di conservazione, ogni 30 minuti, cancella le righe più vecchie di 10 minuti.
- **Se il titolare ripassa subito**: chi torna alla stessa porta entro i 30 secondi dello stesso codice riceve `QR_USED` finché il telefono non mostra il codice successivo, cioè al massimo 30 secondi. Lo stesso lettore, per 90 secondi, ignora in silenzio un QR identico a quello appena letto, quindi il messaggio compare soprattutto su un secondo lettore della stessa porta.
- **Cosa resta possibile**: uno screenshot usato prima del titolare apre ancora una volta ogni porta permessa senza anti-passback, nei circa 90 secondi di validità. Sulle porte con l'anti-passback entra solo il primo dei due; vedi *Anti-passback*, più sotto.
- **Telefono perso o cambiato**: in **Dipendenti** si usa "Disattiva badge telefono". Il dipendente lo riattiva con un nuovo codice, e attivarlo su un nuovo telefono disattiva quello vecchio.
- **Togliere il badge dal telefono**: il dipendente lo fa da sé in **Impostazioni**, il link sotto il badge nell'app e su `/badge`. Il badge smette di funzionare anche sul server. In **Dipendenti** l'interruttore "I dipendenti possono togliere il badge dal proprio telefono" (lo cambia solo il ruolo Amministratore) toglie questa possibilità: il tasto sparisce e la richiesta viene rifiutata (`SELF_REMOVE_DISABLED`), quindi il badge lo disattiva solo la console. Un badge già disattivato dalla console si può sempre togliere dal telefono, per poterlo attivare di nuovo. Disinstallare l'app resta comunque possibile.
- **Protezioni del codice email**: vale 10 minuti, ha al massimo 5 tentativi e ci sono limiti di richieste al minuto. La richiesta del codice risponde sempre allo stesso modo, così non si può scoprire quali email sono registrate.

## Anti-passback

L'anti-passback rifiuta l'ingresso a chi risulta già dentro, cioè a chi oggi è entrato e non è ancora passato da una porta di uscita. Serve contro il badge, o lo screenshot del QR, passato a un collega che aspetta fuori. È spento di default e si accende porta per porta.

> **Prima di accenderlo** imposta le porte di Uscita, ognuna con il suo lettore, e mostra alla reception dove si trova **Porte → Risultano dentro**: chi esce senza passare il badge resta bloccato fuori finché qualcuno non lo segna come uscito da lì (vedi *Segnare un'uscita dalla console*).

### Come decide il lettore

Ogni porta ha una **direzione**: *Nessuna* (il valore predefinito), *Ingresso* o *Uscita*. L'interruttore **Anti-passback** c'è solo sulle porte di Ingresso.

Quando qualcuno passa la credenziale su un Ingresso con l'anti-passback, il server cerca il suo ultimo passaggio **concesso** di oggi nella stessa sede, su una porta di Ingresso o di Uscita; "oggi" parte dalla mezzanotte nel fuso orario della sede. Se quel passaggio è un ingresso, rifiuta con `ANTI_PASSBACK` e il lettore mostra «Risulti già dentro: se sei uscito senza passare il badge, chiedi alla reception». Se è un'uscita, anche quella segnata dalla console, o se oggi non c'è niente, la persona entra.

- Il controllo arriva dopo credenziale, validità, permesso e orario, e prima del controllo del QR già usato (`QR_USED`). Chi non ha il permesso riceve `NO_PERMISSION` come prima.
- Le porte con direzione *Nessuna* non contano: passarci non fa risultare né dentro né fuori.
- Un'Uscita non rifiuta mai per anti-passback e non guarda giorni e orari, così nessuno resta chiuso dentro dopo l'orario: con un permesso 08:00-19:00, chi esce alle 19:30 passa. Non serve nemmeno un permesso su quella porta: basta una regola su una porta **attiva** qualsiasi della stessa sede, e chi non ne ha nessuna riceve `NO_PERMISSION`. Una regola su una porta disattivata non conta. Tutti gli altri controlli restano: credenziale, dipendente attivo e nel periodo di validità, app Porte accesa per la persona, porta attiva, QR scaduto o già usato su quella porta.
- Un'uscita negata non conta come uscita: la persona resta "dentro" finché non passa da un'Uscita o la reception non la segna come uscita.
- Ogni passaggio salva la direzione che la porta aveva in quel momento, nella colonna `access_events.direction`. Se cambi la direzione di una porta a metà giornata, i passaggi già registrati non cambiano significato. I passaggi di prima di questa versione hanno la colonna vuota (`NULL`) e non contano.
- Un QR rifiutato per anti-passback non viene consumato.
- Se la stessa persona si presenta a due ingressi con l'anti-passback nello stesso istante (il titolare con il QR, un altro con lo screenshot), il server mette in fila le due richieste e ne passa una sola.

### Configurare una sede

Direzione e anti-passback li cambiano l'Amministratore (SUPER_ADMIN) e il Responsabile di sede (SITE_MANAGER), quest'ultimo solo per le sue sedi, da **Porte e lettori → Modifica**. Il sistema esterno può fare lo stesso con l'API (`PUT /doors/{id}`, sopra).

1. Imposta *Uscita* su ogni porta da cui si esce passando il badge, e solo su lettori montati dal lato interno: un lettore di Uscita dà verde a qualsiasi ora a chiunque abbia un permesso su una porta attiva della sede, quindi se lo raggiunge chi sta fuori diventa un ingresso senza orari. Una porta di uscita registra chi esce solo se ha un lettore.
2. Sulle Uscite non servono permessi a parte: esce chiunque abbia un permesso su una porta attiva della sede, a qualsiasi ora. Una regola che c'è già sulla porta di Uscita conta come permesso nella sede, ma i suoi giorni e orari no; se la porta torna *Ingresso* o *Nessuna*, ricominciano a valere.
3. Imposta *Ingresso* su ogni porta con lettore da cui si entra e accendi l'anti-passback su tutte, nessuna esclusa: una sola porta scoperta basta per entrare con il badge di un altro (vedi *Limiti*).
4. In **Porte e lettori** controlla che nessuna porta della sede abbia l'etichetta **Senza anti-passback**.

La console avvisa in tre casi:

- quando imposti un Ingresso con l'anti-passback in una sede che non ha nessun'altra porta di uscita attiva: «In questa sede non c’è nessuna porta di uscita attiva: chi esce non viene registrato e non può rientrare fino a mezzanotte. Imposta Uscita su almeno una porta.» L'avviso conta anche le porte di uscita senza lettore: controlla a mano che ognuna ne abbia uno;
- quando in una sede con l'anti-passback su almeno una porta restano porte attive con un lettore, con direzione *Nessuna* o di Ingresso senza anti-passback. Nell'elenco hanno l'etichetta **Senza anti-passback**, e il modulo della porta con l'anti-passback le nomina;
- quando stai modificando una di quelle porte e la lasceresti scoperta.

Ogni modifica finisce nel **Registro accessi**: `DOOR_CREATED` con direzione e anti-passback; `DOOR_UPDATED` (dalla console) e `API_DOOR_UPSERT` (dall'API) con i valori precedenti in `before` quando uno dei due cambia.

### Limiti

**Copertura.** L'anti-passback protegge una sede solo se tutti gli ingressi con lettore lo hanno acceso. Chi è già dentro può passare il badge o il QR a un altro, che entra da una porta scoperta.

**Uscita senza badge.** Chi esce senza passare il badge (dietro a un collega, da un'uscita senza lettore, con un'uscita negata) resta "dentro" fino a mezzanotte, e il lettore lo rimanda alla reception. La reception lo sblocca con «Segna come uscito», una persona alla volta: vedi *Segnare un'uscita dalla console*, qui sotto.

**Turni di notte.** A mezzanotte, ora della sede, lo stato si azzera per tutti. Chi è dentro dopo mezzanotte risulta fuori e può prestare il badge.

**Sedi diverse.** Ogni sede fa storia a sé: chi è dentro nella sede A entra senza problemi nella sede B.

**Presenza del titolare.** Chi ha la credenziale di un collega e riceve `ANTI_PASSBACK` capisce che il titolare è in sede. Il tentativo resta nei Passaggi con l'id del titolare, quindi si può risalire a quando è successo.

**Notifiche.** Se un canale di *Notifiche* riceve l'evento «Una porta rifiuta un badge» (`access.denied`) e ha acceso *Includi i nomi di ospiti e dipendenti*, il messaggio dice chi è stato rifiutato e perché: con `ANTI_PASSBACK`, dice a Slack o Teams che quella persona risulta in sede.

### Segnare un'uscita dalla console

In **Porte → Risultano dentro** c'è l'elenco di chi oggi risulta dentro in una sede, con la stessa regola dell'anti-passback: l'ultimo passaggio concesso di oggi, su un Ingresso o un'Uscita, è un ingresso. Le porte con direzione *Nessuna* non contano. Per ogni persona ci sono nome, reparto, ora dell'ultimo ingresso nel fuso della sede e porta da cui è entrata. La voce la vedono Amministratore, Responsabile di sede e Receptionist, questi ultimi due solo per le proprie sedi; l'Auditor no, e con l'app Porte spenta non c'è per nessuno.

- La ricerca per nome o cognome filtra l'elenco già caricato, senza mandare niente al server.
- Chi ha più sedi le sceglie dal selettore in alto, una alla volta; con una sola sede il selettore non c'è.
- L'elenco non si aggiorna da solo: si ricarica quando apri la pagina, dopo ogni uscita segnata e con il tasto **Aggiorna**.

Non è l'appello di **Evacuazione**, che conta chiunque sia passato da una porta oggi, anche se poi è uscito.

**Segna come uscito.** Il tasto su ogni riga apre una finestra in cui scegli il motivo; il tasto di conferma resta spento finché non ne scegli uno, e non c'è un campo di testo libero, perché finirebbe per contenere note sulla persona. I motivi sono quattro:

| Codice | In console |
|---|---|
| `NO_BADGE_EXIT` | Uscita senza passare il badge |
| `NO_READER_EXIT` | Uscita da una porta senza lettore |
| `EXIT_DENIED` | Uscita negata dal lettore |
| `OTHER` | Altro |

Confermando, il server registra un'uscita con l'ora di quel momento e la persona sparisce dall'elenco. Al passaggio successivo da un Ingresso con l'anti-passback entra. L'uscita vale solo per quella sede: se la persona risulta dentro anche in un'altra, lì resta dentro. Non cambia permessi né validità, quindi si può segnare anche per un dipendente disattivato o scaduto.

Cosa resta:

- in **Passaggi**, una riga con esito «Consentito», «Uscita segnata dalla console» al posto della porta e «A mano» come metodo. Nel database è una riga di `access_events` con `method = 'MAN'`, `reason = 'MARKED_OUT'`, `direction = 'OUT'` e `doorId` e `readerId` vuoti. Il filtro «Consentito» la mostra, «Negato» no. Viene cancellata dopo `ACCESS_LOG_RETENTION_DAYS` giorni come gli altri passaggi, e non conta nei numeri delle porte della dashboard;
- nel **Registro accessi**, una voce `ACCESS_MARKED_OUT` («Dipendente segnato come uscito») con il dipendente, la sede, chi l'ha segnata, l'IP e il motivo;
- ogni apertura dell'elenco scrive `ACCESS_INSIDE_VIEW` («Consultata la lista Risultano dentro») con la sede e il numero di righe, senza nomi.

Né l'elenco né l'uscita segnata mandano notifiche a Teams, Slack o altri sistemi.

**Se la persona risulta già uscita.** Se nel frattempo è passata da un'Uscita, o un collega l'ha già segnata, il server risponde `409 NOT_INSIDE` e non registra niente. La console mostra, per esempio, «Rossi Mario risulta già uscito: la lista è aggiornata.» e ricarica l'elenco, quindi non serve fare altro. Se il dipendente è stato cancellato nel frattempo, il messaggio è «Questa persona non è più tra i dipendenti: la lista è aggiornata.». Due conferme nello stesso istante per la stessa persona producono una sola uscita: la seconda riceve `NOT_INSIDE`.

Per chi integra la console, gli endpoint sono `GET /api/admin/access/inside?siteId=<uuid>` e `POST /api/admin/access/employees/{id}/mark-out` con corpo `{"siteId":"<uuid>","reason":"NO_BADGE_EXIT"}`. Una sede fuori dalle proprie dà 403, una sede o un dipendente che l'organizzazione non ha danno 404 (`SITE_NOT_FOUND`, `EMPLOYEE_NOT_FOUND`), un motivo fuori elenco dà 400.

### Il QR monouso resta per porta

L'anti-passback non prende il posto del monouso descritto sopra. Uno screenshot usato prima del titolare apre ancora una volta ogni porta senza anti-passback, finché il codice vale (circa 90 secondi). Su un Ingresso con l'anti-passback entra solo il primo che arriva; se è l'altro, il titolare riceve `ANTI_PASSBACK` quando ci prova, e almeno lui vede che qualcosa non torna.

## Tessere NFC

**Cosa serve per leggerle.**
- **Chrome su Android**, con l'NFC attivo nelle impostazioni del telefono. La prima volta si tocca "Attiva tessere NFC" e si concede il permesso; poi il lettore lo attiva da solo a ogni apertura.
- iPhone, computer e altri browser **non** leggono l'NFC da una pagina web: il lettore lo dice a schermo.

**Quali tessere legge Chrome.** Solo le tessere in formato **NDEF** (NTAG, adesivi NFC, molte tessere programmabili). Molte tessere di accesso aziendali (MIFARE Classic, DESFire, HID) **non** lo sono. Chrome le rileva ma non passa il codice alla pagina, e il lettore mostra "Tessera rilevata ma non leggibile".

**Per quelle tessere** si usa un **lettore NFC USB "a tastiera"** (costa pochi euro): legge l'UID di qualsiasi tessera e lo "digita" nella pagina del lettore. Funziona su tablet Android con cavo OTG e su qualsiasi computer.

**Provare senza tessere né lettori.** Apri il lettore con `?simula=1` in fondo all'indirizzo (es. `https://<indirizzo>/reader?simula=1`): compare un pannello dove si scrive l'UID di una tessera e si preme "Avvicina tessera". Il lettore esegue la stessa verifica e registra il passaggio come una tessera vera. Senza `?simula=1` il pannello non compare, quindi i lettori alle porte non lo mostrano.

**Il telefono come tessera.** Una pagina web non può far funzionare il telefono come una carta contactless: serve un'app nativa o un pass in Apple/Google Wallet. Per il telefono si usa il QR.


- **Cosa si legge**: il lettore legge l'**UID** della tessera. Nel database c'è solo un indice cifrato dell'UID (HMAC con la chiave dell'organizzazione) e le ultime 4 cifre per riconoscerla in console.
- **Limite di sicurezza**: l'UID delle tessere economiche (es. MIFARE Classic) si può copiare. Per le porte critiche meglio il QR sul telefono o tessere con autenticazione crittografica (DESFire), da valutare con il fornitore delle tessere.

## Persone da visitare e inviti dal telefono

In **Persone da visitare** → **Nuova persona** si può scegliere tra i dipendenti, cercando per nome, email o reparto. Nome ed email arrivano dal gestionale e si aggiornano da soli quando cambiano. Se il dipendente viene cancellato, resta tra le persone da visitare ma non più collegato. Chi non è un dipendente (un consulente, per esempio) si inserisce a mano come prima.

Un dipendente collegato che ha attivato il badge, nell'app *Il mio badge* o nella pagina web `/badge`, ha in più il pulsante **I miei inviti**:
- crea un invito per un proprio ospite, scegliendo sede (solo quelle in cui riceve visite), giorno, ora e motivo;
- l'ospite riceve la stessa email con QR degli inviti creati in console;
- dall'app può condividere codice e istruzioni, vedere chi aspetta e annullare.

In console l'invito compare con l'etichetta "dall'app". L'app usa un token separato dal segreto del QR. Il token nasce con l'attivazione del badge e si revoca insieme al telefono (Dipendenti → *Revoca telefono*). Chi aveva attivato il badge prima di questa versione deve rimuoverlo e attivarlo di nuovo una volta.


### Notifica quando arriva l'ospite

Nella stessa schermata **I miei inviti**, sia nell'app sia sulla pagina `/badge`, c'è l'interruttore *Avvisami quando arriva un ospite*. Quando un ospite di quella persona fa check-in al tablet, sul telefono arriva "È arrivato il tuo ospite · Ti aspetta in reception, sede di Milano". Vale per tutti gli arrivi, con o senza invito.

- **Nome dell'ospite**: escluso di default, perché la notifica compare sullo schermo bloccato. L'amministratore lo attiva in **Notifiche** → *Sul telefono di chi riceve la visita*.
- **Pagina `/badge`**: funziona con Chrome, Edge e Firefox. Su iPhone solo dopo *Condividi → Aggiungi alla schermata Home*, aprendo il badge da lì (regola di Apple, iOS 16.4 o successivo).
- **App**: vedi `APP-MOBILE.md` per Expo Go e per le chiavi di Android e iPhone.
- Il telefono smette di ricevere quando il badge viene rimosso, disattivato in console (*Revoca telefono*), attivato su un altro telefono, o il dipendente viene eliminato. Se il browser o Expo dicono che il telefono non esiste più, il server lo dimentica da solo.
- Una notifica non partita al primo colpo viene ritentata dopo 1 e 3 minuti; poi si rinuncia, perché un avviso di arrivo in ritardo non serve.