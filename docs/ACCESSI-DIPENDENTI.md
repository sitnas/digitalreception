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
- ogni consultazione finisce nel registro accessi della console.

## Come si configura

1. **Console → Integrazione API → Crea chiave.** La chiave (`drk_…`) si vede una volta sola: va consegnata al fornitore del sistema esterno. Si può revocare in qualsiasi momento.
2. **Porte.** Il sistema esterno le crea con l'API, oppure le crea l'amministratore in **Console → Porte e lettori**. Ogni porta ha un **codice esterno**, lo stesso usato dal sistema esterno.
3. **Lettori.** In **Porte e lettori → Associa lettore** si ottiene un codice di 8 caratteri. Sul tablet o telefono Android alla porta si apre `https://<indirizzo>/reader`, si inserisce il codice e il lettore resta associato a quella porta.
   - **QR**: il lettore usa la fotocamera frontale.
   - **Tessere NFC**: su Chrome per Android si tocca una volta "Attiva tessere NFC". In alternativa si collega un lettore NFC USB che funziona come tastiera.
4. **Dipendenti.** Il sistema esterno li invia con l'API. Ognuno attiva il badge sul telefono dalla pagina `https://<indirizzo>/badge`: inserisce l'email di lavoro, riceve un codice di 6 cifre e lo digita. Serve l'invio email attivo (vedi Organizzazione).

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
| `PUT` | `/doors/{id}` | Crea o aggiorna una porta. Corpo: `siteCode` (codice della sede in console), `name`, `active` (facoltativo). |
| `PUT` | `/employees/{id}` | Crea o aggiorna un dipendente e i suoi permessi (vedi sotto). |
| `DELETE` | `/employees/{id}` | Cancella il dipendente e i permessi; il registro perde il collegamento alla persona. |

Corpo di `PUT /employees/{id}`:

```json
{
  "firstName": "Mario",
  "lastName": "Rossi",
  "email": "mario.rossi@azienda.it",
  "department": "Acquisti",
  "jobTitle": "Buyer",
  "badgeUid": "04:A2:1B:9C",
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
| `EMPLOYEE_INACTIVE` | Dipendente non attivo |
| `NOT_YET_VALID` | Periodo di validità non ancora iniziato |
| `EXPIRED` | Periodo di validità terminato |
| `DOOR_INACTIVE` | Porta disattivata |
| `NO_PERMISSION` | Nessun permesso per quella porta |
| `OUTSIDE_SCHEDULE` | Fuori dai giorni o dagli orari consentiti |

## Come funziona il QR sul telefono

- **Attivazione**: dopo il codice via email il server genera un segreto casuale di 32 byte. Lo salva cifrato con la chiave dell'organizzazione e lo consegna una sola volta al telefono.
- **Generazione del QR**: il telefono calcola ogni 30 secondi `DRE1:<id>.<passo>.<firma>`, dove la firma è un HMAC-SHA256 del passo temporale. Il QR si genera anche senza connessione.
- **Verifica**: il server accetta il passo corrente e quelli vicini (±30 secondi). I codici più vecchi vengono rifiutati come `QR_EXPIRED`, quindi una foto passata a un collega smette di funzionare entro un minuto.
- **Telefono perso o cambiato**: in **Dipendenti** si usa "Disattiva badge telefono". Il dipendente lo riattiva con un nuovo codice, e attivarlo su un nuovo telefono disattiva quello vecchio.
- **Protezioni del codice email**: vale 10 minuti, ha al massimo 5 tentativi e ci sono limiti di richieste al minuto. La richiesta del codice risponde sempre allo stesso modo, così non si può scoprire quali email sono registrate.

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

Un dipendente collegato che ha attivato l'app *Il mio badge* ha in più il pulsante **I miei inviti**:
- crea un invito per un proprio ospite, scegliendo sede (solo quelle in cui riceve visite), giorno, ora e motivo;
- l'ospite riceve la stessa email con QR degli inviti creati in console;
- dall'app può condividere codice e istruzioni, vedere chi aspetta e annullare.

In console l'invito compare con l'etichetta "dall'app". L'app usa un token separato dal segreto del QR. Il token nasce con l'attivazione del badge e si revoca insieme al telefono (Dipendenti → *Revoca telefono*). Chi aveva attivato il badge prima di questa versione deve rimuoverlo e attivarlo di nuovo una volta.
