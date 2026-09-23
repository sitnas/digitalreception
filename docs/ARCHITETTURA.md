# Architettura

## Obiettivi che hanno guidato le scelte

1. **Vendibile a più aziende** con un solo codice: stessa applicazione in SaaS condiviso o installata presso un singolo cliente.
2. **Privacy by design e by default** (art. 25 GDPR): minimizzazione, cifratura, cancellazione automatica, tracciabilità.
3. **Costo zero di licenze**: solo componenti open source; nessun servizio cloud obbligatorio.
4. **Scalabilità orizzontale** senza cambiare codice: da un server con 10 sedi a più repliche con centinaia di clienti.

## Multi-tenancy

Ogni cliente è un *tenant*. Tutte le tabelle hanno la colonna `tenantId` e ogni query la usa come primo filtro.

**Come viene riconosciuto il tenant.** Un middleware lo risolve dal nome host prima che qualunque controller venga eseguito.
- `TENANCY_MODE=single`: installazione dedicata; il tenant è sempre `DEFAULT_TENANT_SLUG`.
- `TENANCY_MODE=subdomain`: SaaS condiviso; `acme.reception.example.com` corrisponde al tenant `acme`. Un host sconosciuto riceve 404.

**Isolamento difensivo su più livelli**, così che un singolo errore non basti a far trapelare dati:

| Livello | Meccanismo |
|---|---|
| Rete / browser | cookie di sessione *host-only*: il browser non invia la sessione di un cliente al dominio di un altro |
| Sessione | il token contiene il `tenantId` e viene rifiutato se non coincide con il tenant dell'host |
| Tablet | il token del dispositivo è valido solo sul tenant che lo ha emesso |
| Query | ogni accesso ai dati filtra per `tenantId` preso dalla sessione verificata, mai dai parametri della richiesta |
| Crittografia | ogni tenant ha chiavi proprie; il testo cifrato è legato al tenant tramite *associated data*, quindi un dato copiato in un altro tenant non si decifra |

Verifiche eseguite su database reale: sessione e tablet del tenant A usati sull'host del tenant B sono rifiutati (401); l'ID di una visita di B letto da un amministratore di A dà 404; lo stesso cognome produce indici di ricerca diversi nei due tenant; le statistiche e il registro accessi di A non contengono eventi di B.

**Cancellazione di un cliente (crypto-shredding).** `npm run tenant -- delete` distrugge prima le chiavi del tenant, poi i file e le righe. Da quel momento anche le copie nei backup precedenti sono illeggibili: si risponde all'obbligo di restituzione/cancellazione a fine contratto senza dover riscrivere i backup.

**Piani commerciali.** Ogni tenant ha limiti opzionali di sedi, tablet e utenti (`--max-sites`, `--max-devices`, `--max-users`), applicati dall'API.

**Personalizzazione.** Nome e logo del cliente compaiono su tablet e pagina di accesso. Paesi, lingue, tempi di conservazione e informative sono configurabili dal cliente.

## Crittografia (envelope encryption)

```
MASTER_KEYS (variabili d'ambiente, custodite dall'infrastruttura)
   └─ cifrano ─> chiavi del tenant (DEK dati + chiave per gli indici di ricerca), salvate cifrate nel DB
                    └─ cifrano ─> nome, cognome, azienda, email, referente, numero documento, immagini
```

- AES-256-GCM, IV casuale per ogni valore; ogni valore porta l'identificativo della chiave, così la rotazione non richiede di ricifrare tutto.
- Ricerca per cognome ed email tramite *blind index* (HMAC-SHA256 con chiave del tenant): corrispondenza esatta senza testo in chiaro nel database.
- Rotazione della chiave master: si aggiunge la nuova, si esegue `rewrap-keys` (riavvolge solo le chiavi dei tenant, operazione istantanea), poi si rimuove la vecchia.
- Le chiavi dei tenant restano in memoria solo per 5 minuti.

## Scalabilità

| Aspetto | Soluzione |
|---|---|
| API | stateless (sessione in JWT verificato contro il DB): si aggiungono repliche dietro un bilanciatore |
| Job in background | eseguibili su ogni replica; un lock nominato del database (`GET_LOCK`) garantisce una sola esecuzione per volta |
| Conservazione dati | elaborata a lotti di 500, per tenant e per sede |
| Email | *outbox* transazionale: il check-in segna l'email come da inviare, un worker la consegna con tre tentativi; nulla si perde in caso di riavvio |
| Immagini | driver `local` (un nodo o volume condiviso) o `s3` (MinIO on-premise o qualsiasi storage compatibile) |
| Database | indici composti che iniziano con `tenantId`; pool di connessioni configurabile; compatibile con repliche in lettura gestite dall'infrastruttura |
| Frontend | file statici con cache immutabile; il codice della console non viene scaricato dai tablet |
| Salute | `/api/health/live` (processo attivo) e `/api/health` (database raggiungibile) per bilanciatori e orchestratori |

Non è ancora stato eseguito un test di carico: va fatto prima di un'offerta SaaS con volumi importanti. Per un'installazione tipo (10 sedi, centinaia di visite al giorno) un singolo nodo è ampiamente sufficiente; al crescere dei volumi il primo collo di bottiglia atteso è il database, non l'API.

Limite noto: il rate limiting è per singola replica. Con molte repliche conviene spostarlo sul bilanciatore o su uno store condiviso.

## Scelte scartate

| Opzione | Perché no |
|---|---|
| App nativa Flutter | due codebase (tablet e console), distribuzione tramite store o MDM; la web app installabile copre fotocamera, firma e schermo intero |
| AppSheet / low-code | nessun controllo su cifratura, conservazione e audit; vincolo di piattaforma |
| Un database per cliente | più isolamento ma costi e operazioni che crescono con il numero di clienti; la cifratura per tenant dà un isolamento crittografico equivalente per i dati personali. Resta possibile per clienti che lo chiedono: basta un'installazione `single` dedicata |
| Google Fonts / CDN | trasferimento degli IP dei visitatori a terzi (sentenza LG München 2022) |
