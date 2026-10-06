# Operazioni

Tutti i comandi di gestione dei clienti si eseguono dal container dell'API:

```bash
docker compose run --rm api npm run tenant -- <comando> [opzioni]
```

Non esiste una console web "di piattaforma": la gestione dei clienti avviene solo da riga di comando, così non c'è un super-utente esposto su internet.

## Nuovo cliente

```bash
npm run tenant -- create --slug acme --name "Acme S.p.A." --countries IT,ES --admin-email it@acme.com \
  --max-sites 5 --max-devices 5 --max-users 20 --apps reception,access,parcels
```

Crea il tenant con chiavi di cifratura proprie, le app incluse nel servizio (senza `--apps`: Reception, Porte e Pacchi), le regole privacy dei paesi indicati, la prima versione delle informative e il primo amministratore. La password temporanea compare una sola volta: va comunicata su un canale diverso dall'email.

In modalità `subdomain` serve un record DNS (o un wildcard `*.BASE_DOMAIN`) e un certificato che copra il sottodominio.

## Altri comandi

| Comando | Effetto |
|---|---|
| `list` | clienti, stato, utilizzo rispetto ai limiti |
| `apps --slug acme --apps reception,access,parcels,parking` | le app incluse nel servizio del cliente, vedi sotto |
| `limits --slug acme --max-sites 10` | cambia i limiti del piano (`none` = illimitato) |
| `suspend --slug acme` / `activate` | blocca o riattiva l'accesso (entro 60 secondi su tutte le repliche); i dati restano e la conservazione continua |
| `delete --slug acme --confirm acme` | cancellazione definitiva con distruzione delle chiavi |
| `rewrap-keys` | dopo aver aggiunto una nuova chiave master |
| `reset-mfa --slug acme --email it@acme.com` | azzera la verifica in due passaggi di un utente (es. l'unico amministratore ha perso telefono e codici di recupero); chiude le sue sessioni. Verificare prima l'identità della persona su un canale indipendente |
| `sso-off --slug acme` | toglie l'obbligo di accesso con Microsoft/Google quando il servizio non risponde e nessun account di emergenza funziona; il collegamento resta |
| `reset-password --slug acme --email it@acme.com` | assegna una password temporanea (mostrata una volta, da cambiare al primo accesso), sblocca l'account dopo troppi tentativi e chiude le sessioni. La verifica in due passaggi resta attiva. Stesse cautele sull'identità |

Tutti i comandi scrivono un evento nel registro accessi di piattaforma.

## Accesso con Microsoft o Google (SSO)

Le due app si registrano **una volta sola** per tutta la piattaforma. Poi ogni cliente, dalla console, sceglie Microsoft o Google e collega il proprio Microsoft 365 o Google Workspace, senza toccare il server.

L'indirizzo di ritorno è sempre lo stesso: `https://<indirizzo della console>/api/auth/sso/callback`. In modalità `subdomain` va bene l'indirizzo di un qualunque cliente, oppure un nome dedicato, per esempio `login.reception.example.com`, che punta allo stesso server. Va messo in `SSO_REDIRECT_URI` e registrato identico presso Microsoft e Google.

### Microsoft Entra ID

1. [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **Registrazioni app** → **Nuova registrazione**.
2. Nome: per esempio "Registro visitatori". Tipi di account: **Account in qualsiasi directory organizzativa (multi-tenant)**. URI di reindirizzamento: piattaforma **Web**, l'indirizzo di ritorno sopra.
3. Copia **ID applicazione (client)** in `SSO_MICROSOFT_CLIENT_ID`.
4. **Certificati e segreti** → **Nuovo segreto client** → copia il **Valore** in `SSO_MICROSOFT_CLIENT_SECRET`. Il segreto scade: segnati la data e rinnovalo prima.
5. Non servono altri permessi: bastano `openid`, `email` e `profile`, già inclusi.

Se nell'azienda cliente gli utenti non possono approvare app da soli, il primo accesso mostra "serve l'approvazione dell'amministratore". L'IT del cliente approva una volta da `https://login.microsoftonline.com/<ID tenant del cliente>/adminconsent?client_id=<SSO_MICROSOFT_CLIENT_ID>`.

### Google Workspace

1. [console.cloud.google.com](https://console.cloud.google.com) → nuovo progetto → **API e servizi** → **Schermata consenso OAuth**. Tipo utente **Esterno**, perché lo usano aziende diverse. Aggiungi nome, logo ed email di assistenza, poi **pubblica** l'app. Con i soli ambiti `openid`, `email` e `profile` non serve la verifica approfondita.
2. **Credenziali** → **Crea credenziali** → **ID client OAuth** → tipo **Applicazione web** → **URI di reindirizzamento autorizzati**: l'indirizzo di ritorno sopra.
3. Copia ID client e segreto in `SSO_GOOGLE_CLIENT_ID` e `SSO_GOOGLE_CLIENT_SECRET`.

Sono accettati solo account Google Workspace, non indirizzi @gmail.com.

### Riavvio e attivazione per il cliente

Dopo aver impostato le variabili, riavvia l'API: `docker compose up -d api`. Poi, nella console del cliente, un amministratore:

1. apre **Organizzazione** → **Accesso con l'account aziendale** → **Collega Microsoft** (o Google) ed entra con il proprio account aziendale. Da quel momento vengono accettati solo gli account della stessa organizzazione (tenant Microsoft o dominio Workspace);
2. crea gli utenti in **Utenti** con la **stessa email** che hanno in azienda. Per Microsoft è il nome di accesso (UPN), di solito uguale all'email. Nessun account viene creato in automatico;
3. esce e prova **Accedi con Microsoft**;
4. se vuole, in **Utenti** segna almeno un amministratore come **account di emergenza** e poi attiva **Obbliga l'accesso con l'account aziendale**. Da allora la password funziona solo per gli account di emergenza.

In GitHub Codespaces l'indirizzo di ritorno è `https://<nome-codespace>-8080.app.github.dev/api/auth/sso/callback` e la porta 8080 deve essere pubblica.

## Pre-registrazione degli ospiti dal telefono

Il link "Registrati adesso" nelle email di invito porta a `/guest#CODICE`. Perché compaia serve l'indirizzo pubblico del server:

```
PUBLIC_URL=https://reception.example.com
```

Senza `PUBLIC_URL` il sistema usa l'origine di `SSO_REDIRECT_URI`; se mancano tutte e due l'email resta com'era, con il solo QR. In modalità `subdomain` l'indirizzo diventa `https://<slug>.<BASE_DOMAIN>`. Il codice dell'invito viaggia dopo il `#`, quindi il browser non lo manda al server nei log né ad altri siti.

Firma e foto del documento caricate dal telefono restano cifrate e legate all'invito; all'arrivo passano alla visita e prendono i tempi di conservazione della visita. Se l'invito viene annullato le cancelliamo subito, se l'ospite non arriva le cancella il job di retention 7 giorni dopo il giorno previsto.

## App del portale

La console e il telefono dei dipendenti sono un portale. I **dati comuni** (dipendenti, commesse, sedi, utenti della console, integrazione API) ci sono sempre. Le **app** si attivano su due livelli: prima per il cliente, poi per ogni dipendente.

| App | Nome in `--apps` |
|---|---|
| Reception | `reception` |
| Porte | `access` |
| Pacchi | `parcels` |
| Parcheggi | `parking` |

Cosa porta ciascuna:

| App | In console | Sul telefono |
|---|---|---|
| Reception | Oggi, Inviti, Storico, Evacuazione, Statistiche, Persone da visitare, Tablet, Documenti | I miei inviti, avviso quando arriva un ospite |
| Porte | Porte e lettori, Passaggi | Il badge con QR e NFC |
| Pacchi | Consegne | Avviso e elenco dei pacchi da ritirare |
| Parcheggi | Parcheggi | I miei giorni di parcheggio, prenota e libera |

- **Per cliente**: le attiva chi gestisce la piattaforma, con `npm run tenant -- apps --slug acme --apps reception,access`. L'elenco sostituisce quello di prima e vale subito, senza riavvii. L'organizzazione non può cambiarlo dalla console: in *Impostazioni → App attive* vede le app incluse, quante persone usano ciascuna e, per le altre, che deve chiederle al fornitore. Un'app tolta sparisce dal menu, il tablet mostra che il registro non è attivo e le sue API rispondono `403 APP_DISABLED`. I dati restano: riattivandola si ritrova tutto.
- **Per dipendente**: nella scheda in *Dipendenti*, sezione "App per questa persona". Il sistema HR non tocca questa scelta. Porte spente: il telefono non mostra il QR e il lettore rifiuta con `APP_DISABLED`. Pacchi spenti: la persona non compare tra i destinatari. Reception spenta: niente inviti dall'app.
- Sul telefono (app e `/badge`) ogni app attiva per la persona è una scheda della barra in basso, accanto al badge. Con una sola destinazione la barra non compare. In console, sul telefono, tutte le pagine sono nel menu che si apre dal tasto a sinistra della barra nera.
- Le organizzazioni esistenti hanno Reception, Porte e Pacchi, come prima. Parcheggi va aggiunta con il comando `apps`.

### Parcheggi

- **Posti**: in *Parcheggi* si inseriscono i posti di ogni sede (codice, per esempio `P12`, e una nota facoltativa). Spegnere un posto cancella le sue prenotazioni da oggi in poi; si può eliminare solo un posto mai usato.
- **Benefit**: nella scheda del dipendente, *Parcheggio aziendale*: Nessuno, Standard o Manager. Solo chi ha il benefit vede l'app sul telefono.
- **Manager**: hanno un posto fisso, uno per manager. Ogni lunedì (ora della sede) un job, che gira ogni 10 minuti, prenota il posto da lunedì a venerdì della settimana dopo. La settimana viene segnata, quindi il job non la rifà: un giorno che il manager libera resta libero per gli altri. Quando assegni il ruolo, il posto viene prenotato subito per i giorni rimasti della settimana e per quelle già assegnate. Il tasto `POST /api/admin/parking/weekly` fa lo stesso passaggio a mano.
- **Standard**: nell'app e su `/badge` vedono due settimane come calendario. Toccano uno o più giorni, poi scelgono il posto tra quelli liberi in tutti quei giorni oppure lasciano *Il primo libero*, e prenotano con un tasto solo. Un giorno prenotato si tocca per liberarlo. I giorni prenotabili sono quelli rimasti della settimana; dal giovedì si aggiunge la settimana dopo. Al massimo 4 prenotazioni attive, contate su tutta la richiesta.
  - Con *Il primo libero* il sistema prende il primo posto libero per codice, e i posti fissi dei manager vengono offerti per ultimi.
  - Un posto scelto non viene mai cambiato di nascosto: se nel frattempo un collega l'ha preso, quel giorno non viene prenotato e l'app dice perché. Gli altri giorni passano.
  - L'app mostra solo codice e nota dei posti, mai chi li ha prenotati.
- La reception e i responsabili vedono la settimana posto per posto e possono annullare una prenotazione.

## Notifiche push ai dipendenti

Funzionano senza configurazione: la chiave per il Web Push (pagina `/badge`) viene creata al primo uso e salvata cifrata nel database. Servono soltanto:

- accesso in uscita verso `https://exp.host` (app) e verso i servizi push dei browser (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`);
- per l'app pubblicata, le chiavi Firebase e Apple descritte in `APP-MOBILE.md`.

Variabili facoltative: `EXPO_ACCESS_TOKEN` (se su expo.dev è attiva la sicurezza avanzata per le push), `WEB_PUSH_PUBLIC_KEY` e `WEB_PUSH_PRIVATE_KEY` (per usare una coppia di chiavi propria: `npx web-push generate-vapid-keys`), `WEB_PUSH_SUBJECT` (contatto per i servizi push, di default `mailto:` + `MAIL_FROM`). Le notifiche non partite subito vengono ritentate dal job `push-outbox`, controllato anche da `/api/health/ops`.

## Rotazione della chiave master

1. Genera una nuova chiave: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Aggiungila in coda: `MASTER_KEYS=k1:<vecchia>,k2:<nuova>` e riavvia tutte le repliche.
3. `npm run tenant -- rewrap-keys`.
4. Rimuovi `k1` dalla variabile e riavvia.

I dati personali non vengono ricifrati: cambia solo l'involucro delle chiavi dei tenant.

## Aggiornamenti

Le migrazioni del database vengono applicate automaticamente all'avvio dell'API. Con più repliche, aggiorna prima una replica e attendi che sia pronta (`/api/health`) prima delle altre.

## Backup e ripristino

Salvare insieme database e archivio immagini. Le chiavi master vanno conservate **separatamente**: senza di esse il backup non è leggibile, ed è voluto. Un backup ripristinato è utilizzabile solo con le chiavi master valide al momento del backup (o successive, se è stato eseguito `rewrap-keys`).

## Monitoraggio

- `/api/health/live`: il processo risponde.
- `/api/health`: il processo può servire traffico (database raggiungibile).
- `/api/health/ops`: lo stato del lavoro in background, per un servizio di monitoraggio (UptimeRobot, Better Stack, Zabbix…). Si attiva impostando `HEALTH_TOKEN` (almeno 24 caratteri) e si chiama con `Authorization: Bearer <HEALTH_TOKEN>`. Risponde **503** quando:
  - la pulizia dei dati non gira da più di 90 minuti, o le code di email, notifiche e push da più di 10;
  - un job ha dato errore nell'ultima ora;
  - ci sono email ferme in coda da più di 15 minuti.

  Il corpo elenca il problema in chiaro, per esempio `retention: not run for 180 min`, e contiene solo conteggi, nessun dato personale.
- Log applicativi su stdout, senza dati personali; le esecuzioni dei job di conservazione compaiono nel log e nel registro accessi.

## Più repliche

1. `STORAGE_DRIVER=s3` (o un volume condiviso tra le repliche).
2. Tutte le repliche con le stesse variabili d'ambiente.
3. `TRUST_PROXY` uguale al numero di proxy davanti all'API, per avere gli IP corretti nel registro accessi.
4. I job girano in una sola replica alla volta grazie al lock sul database; `JOBS_ENABLED=false` li esclude da una replica specifica.
5. `THROTTLE_STORE=database`: i limiti di tentativi (login, codici, accesso SSO) vengono contati nel database e valgono per tutte le repliche insieme. Con il valore predefinito, `memory`, ogni replica conta per conto suo: con tre repliche un attaccante avrebbe il triplo dei tentativi. Costa una scrittura sul database per richiesta.
