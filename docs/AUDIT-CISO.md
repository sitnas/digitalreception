# Audit di sicurezza Mortise, ottobre 2026

Audit dal punto di vista di un CISO che deve decidere se mettere Mortise in produzione: Reception, Porte, Pacchi e Parcheggi, con console, tablet, app del dipendente, pagina `/badge`, lettore alle porte e API di integrazione. È stato fatto il 5 ottobre 2026 sul codice del ramo principale dopo la PR #69, più le correzioni della PR #70.

[SICUREZZA-PRIVACY.md](SICUREZZA-PRIVACY.md) descrive i controlli previsti; questo documento dice quali sono stati verificati, cosa non andava e cosa resta da fare.

## Metodo

- Lettura del codice di API, console, app mobile e configurazioni di deploy (`docker-compose.yml`, `web/deploy/nginx.conf`, Dockerfile).
- Test automatici del progetto: 46 test API (unità ed end-to-end su MariaDB), 9 test web e 21 dell'app mobile, tutti passati.
- Header HTTP misurati su un nginx vero con la configurazione di produzione, e la console caricata in Chromium con la CSP attiva.
- `npm audit --omit=dev` su API, web e app mobile.
- Ricerca di segreti nel repository (file `.env`, chiavi, certificati) e nella CI.

Non sono stati fatti un test di penetrazione dall'esterno né prove su un'infrastruttura di produzione. Anche il traffico reale, i backup e il servizio SMTP restano fuori.

## In breve

L'impianto regge. Ogni cliente ha chiavi di cifratura proprie (AES-256-GCM), e l'isolamento fra clienti c'è in ogni query controllata: le sessioni sono legate al cliente dell'host, e un token di un'organizzazione non vale su un'altra. Autenticazione, registro accessi e conservazione dei dati sono sopra la media dei prodotti di questa categoria.

Il problema più serio era di configurazione e non di codice. Le pagine della console arrivavano al browser senza nessun header di sicurezza, CSP compresa, perché nginx scarta gli header del server in ogni `location` che ne aggiunge uno suo. È corretto nella PR #70 e verificato.

Restano aperti un rischio medio sul badge del telefono (il QR si può riusare per circa 90 secondi), aggiornamenti di dipendenze da pianificare e alcune mancanze tipiche da contesto enterprise: chiavi master fuori da un KMS, nessuna scansione automatica in CI, nessun invio del registro accessi a un SIEM.

| Severità | Trovati | Corretti | Aperti |
|---|---|---|---|
| Alta | 1 | 1 | 0 |
| Media | 5 | 0 | 5 |
| Bassa | 5 | 0 | 5 |
| Informativa | 2 | 0 | 2 |

## Risultati

### A1. Pagine della console senza header di sicurezza (alta, corretto)

In `web/deploy/nginx.conf` gli header (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`) erano dichiarati a livello di `server`. Le `location /` e `/assets/` aggiungono un loro `Cache-Control`, e in nginx questo basta a far perdere tutti gli header ereditati. Misurato con curl: `/admin` rispondeva solo con `Cache-Control: no-cache`.

Le conseguenze:
- senza `frame-ancestors` la console si poteva incorniciare in un altro sito, quindi era esposta al clickjacking;
- senza CSP un'eventuale falla XSS avrebbe potuto leggere il segreto del badge salvato dalla pagina `/badge`;
- senza HSTS il primo accesso poteva passare in chiaro, se il proxy aziendale non lo imponeva per conto suo.

L'API non era coinvolta: ha i suoi header tramite helmet.

**Correzione (PR #70).** Le due `location` ripetono gli header, in entrambe le configurazioni nginx. Con la CSP finalmente applicata è emerso un secondo difetto: Vite incorporava i font piccoli come `data:`, che `font-src 'self'` blocca. Ora i font sono sempre file separati. Verificato con nginx e Chromium su console (sette pagine e un cassetto), tablet, `/badge` e lettore: zero violazioni della CSP, font caricati.

### M1. QR del badge riutilizzabile per circa 90 secondi (media, aperto)

Il QR del telefono contiene l'identificativo del dipendente, il passo di tempo da 30 secondi e una firma HMAC-SHA256 troncata a 64 bit. Il lettore accetta il passo corrente, il precedente e il successivo. Nessuno però segna un codice come usato: uno screenshot mandato in chat a un'altra persona apre la stessa porta finché il codice resta valido, cioè fino a circa 90 secondi. Lo stesso vale per il codice trasmesso via NFC.

**Raccomandazione.** Il lettore dovrebbe accettare ogni coppia dipendente e passo una sola volta per porta, per esempio con una tabella dei codici usati che scade dopo due minuti. Per le porte sensibili conviene anche l'anti-passback (non si rientra senza essere usciti). È un intervento contenuto nel servizio di verifica, `api/src/access/access.service.ts`.

### M2. Dipendenze con avvisi noti (media, aperto)

| Progetto | Esito di `npm audit --omit=dev` | Valutazione |
|---|---|---|
| API | 2 alte, 7 medie, 1 bassa; tutte risalgono a NestJS 11 | L'avviso alto su `multer` non è raggiungibile: nessuna rotta accetta upload multipart, le immagini arrivano in JSON. Quello su `body-parser` riguarda un limite non valido, ma qui il limite è esplicito (12 MB). Si risolve passando a NestJS 12, un aggiornamento di versione maggiore da provare. |
| Web | 2 medie (`react-router`) | Open redirect con percorsi che contengono la barra rovesciata. La console non costruisce percorsi da input esterni; da aggiornare comunque. |
| App mobile | 20 alte, 10 medie | Quasi tutte nella catena di build (Metro, Expo CLI, `braces`, `micromatch`), che non finisce sul telefono. `node-forge` è usato dalla firma degli aggiornamenti di Expo, che il progetto non ha attivato. Si chiude aggiornando l'SDK di Expo. |

Nessuna vulnerabilità critica.

### M3. Nessuna scansione automatica in CI (media, aperto)

La CI (`.github/workflows/ci.yml`) compila e lancia i test, ma installa con `npm ci --no-audit` e non fa analisi statica, ricerca di segreti né produzione di un SBOM. Gli avvisi della sezione precedente si vedono solo lanciando il controllo a mano.

**Raccomandazione.** Aggiungere `npm audit --omit=dev --audit-level=high` (bloccante solo sulle alte raggiungibili), CodeQL o Semgrep, gitleaks e un SBOM CycloneDX allegato a ogni rilascio.

### M4. Chiavi master in variabile d'ambiente (media, aperto)

Le chiavi dei clienti sono cifrate con la chiave master (`MASTER_KEYS`), che l'API legge dall'ambiente. La rotazione c'è (`npm run tenant -- rewrap-keys`), ma è manuale e manca l'integrazione con un KMS o un HSM. Chi legge l'ambiente del container può quindi decifrare tutto. Per un cliente regolato da NIS2 o DORA, la custodia delle chiavi in un KMS (AWS KMS, Azure Key Vault, HashiCorp Vault) è la prima domanda che arriverà.

### M5. Blocco dell'account usabile per bloccare un amministratore (media, aperto)

Dopo 5 password sbagliate l'account si blocca per 15 minuti, con lo stesso messaggio per tutti, così non si capisce se un account esiste. Chi conosce l'email di un amministratore può però bloccarlo di continuo, cambiando IP per aggirare il limite per indirizzo. Con l'SSO obbligatorio il problema sparisce.

**Raccomandazione.** Sostituire il blocco fisso con un ritardo crescente per account e un blocco più lungo solo dopo molti tentativi. In alternativa, chiedere un captcha dopo i primi errori.

### B1. Verifica in due passaggi facoltativa di default (bassa, aperto)

La verifica in due passaggi (TOTP) c'è ed è fatta bene. Solo che è l'amministratore a doverla rendere obbligatoria per tutta l'organizzazione: un Auditor, che vede documenti e immagini dei visitatori, può entrare con la sola password. Proposta: renderla obbligatoria di default per Amministratore e Auditor, quando l'organizzazione non usa l'SSO.

### B2. Chiavi API di integrazione senza limiti (bassa, aperto)

Le chiavi per il sistema del personale sono salvate solo come hash, si revocano e registrano l'ultimo uso. Non hanno però scadenza, permessi ridotti o restrizione per indirizzo IP. Proposta: scadenza facoltativa ed elenco di IP ammessi.

### B3. Sessione della console di 8 ore senza scadenza per inattività (bassa, aperto)

Il cookie è `HttpOnly`, `Secure` e `SameSite=Strict`, e logout, cambio password o cambio di ruolo lo revocano subito. Manca invece un timeout per inattività: su un PC della reception lasciato aperto, la sessione resta valida per tutto il turno. Proposta: un timeout per inattività configurabile, per esempio 30 minuti.

### B4. Limite di 12 MB sul corpo di ogni richiesta (bassa, aperto)

Il limite serve al check-in dal tablet (foto e firma), ma vale per tutte le rotte, anche quelle senza autenticazione come la richiesta del codice del badge. Proposta: 12 MB solo per le rotte del tablet e 100 KB per tutte le altre.

### B5. Segreto del badge nel browser per chi usa `/badge` (bassa, aperto)

L'app mobile tiene il segreto nel portachiavi del sistema (Keychain o Keystore). La pagina web `/badge` lo tiene invece in `localStorage`, leggibile da qualunque script della stessa origine. Dopo la correzione A1 la CSP blocca gli script esterni, quindi il rischio è contenuto. Per le porte sensibili si può comunque imporre l'app, che in più blocca gli screenshot su Android.

### I1. Registro accessi non inviato a un SIEM (informativa)

Il registro è completo e non modificabile dalla console, ma esce solo come CSV. Per un SOC servono l'invio in tempo reale (syslog o webhook firmato) e un formato documentato.

### I2. Nessun test di penetrazione esterno (informativa)

Questo audit legge il codice e la configurazione. Prima del primo cliente in produzione serve un penetration test indipendente sull'installazione reale, proxy e TLS compresi.

## Controlli verificati e funzionanti

- **Isolamento fra clienti.** Il cliente si ricava dall'host. Il token di sessione contiene il cliente e deve coincidere; le query di lettura filtrano per cliente e quelle di modifica partono da righe già caricate con quel filtro.
- **Cifratura applicativa.** AES-256-GCM con chiavi per cliente cifrate dalla master, e indici di ricerca come HMAC (blind index) per email e UID delle tessere.
- **Password.** scrypt (N=32768), minimo 12 caratteri, tempo di risposta costante anche per email inesistenti.
- **SSO OpenID Connect.** PKCE, `state` e `nonce` monouso, account legato all'identificativo immutabile della directory, nessun account creato in automatico.
- **Sessioni.** Cookie `HttpOnly`, `Secure`, `SameSite=Strict` più un header obbligatorio contro il CSRF. Il cookie non è `Secure` solo se lo si disattiva esplicitamente, e in produzione l'API non si avvia così.
- **Codice di attivazione del badge.** 6 cifre, 5 tentativi per finestra di 10 minuti e stessa risposta che l'email esista o no, anche nei tempi.
- **Webhook.** Solo `https`, rifiuto di indirizzi privati e dei metadati cloud al momento della connessione, nessun redirect seguito, firma HMAC.
- **Registro accessi.** Contiene consultazioni, export, cancellazioni e modifiche di configurazione. Non contiene dati dei visitatori e si conserva 365 giorni.
- **Conservazione.** Un job anonimizza le visite e cancella le foto alla scadenza stabilita per ogni paese.
- **Gestione della piattaforma.** Solo da riga di comando, senza un super-utente esposto in rete; ogni operazione finisce nel registro di piattaforma.
- **Container.** L'API gira senza root e con il filesystem in sola lettura; l'utente root del database ha una password casuale che nessuno usa, e l'applicazione ha accesso solo al proprio schema.
- **Repository.** Nessun segreto committato, e l'orologio di test (`TEST_NOW`) viene ignorato in produzione.

## Piano di rientro

| Priorità | Intervento | Stima |
|---|---|---|
| Subito | Unire la PR #70 (A1) e ridistribuire nginx | fatto, manca il deploy |
| Entro 30 giorni | QR monouso per porta e anti-passback facoltativo (M1) | 2-3 giorni |
| Entro 30 giorni | Scansioni in CI: audit, CodeQL o Semgrep, gitleaks, SBOM (M3) | 1 giorno |
| Entro 30 giorni | Due passaggi obbligatori per Amministratore e Auditor (B1) | mezza giornata |
| Entro 90 giorni | NestJS 12, react-router e SDK Expo aggiornati (M2) | 3-5 giorni con i test |
| Entro 90 giorni | Chiavi master in KMS (M4) | 3-4 giorni per un fornitore |
| Entro 90 giorni | Ritardo crescente al posto del blocco fisso (M5), timeout per inattività (B3), limiti del corpo per rotta (B4) | 2 giorni |
| Prima del primo cliente regolato | Invio al SIEM (I1), restrizioni delle chiavi API (B2), penetration test esterno (I2) | da pianificare |

Le stime sono di sviluppo e test, esclusa la revisione del cliente.
