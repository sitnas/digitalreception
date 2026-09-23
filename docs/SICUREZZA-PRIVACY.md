# Sicurezza e privacy

Documento di riferimento per CISO, DPO e responsabili infrastruttura. Descrive cosa fa l'applicazione; le scelte sistemistiche (dove gira, come si fa il backup, dove si custodiscono le chiavi) restano all'infrastruttura, e l'ultima sezione elenca solo i requisiti che l'applicazione ha.

## Dati trattati

| Dato | Obbligatorio | Conservazione predefinita | Cifrato |
|---|---|---|---|
| Nome, cognome | sì | come la visita | sì |
| Azienda | no | come la visita | sì |
| Email | no, serve per ricevere il badge di uscita e, su richiesta, l'informativa | come la visita | sì |
| Persona di riferimento | sì; scelta dall'elenco delle persone da visitare se la sede ne ha uno | come la visita | sì (nome); il collegamento all'elenco si rimuove con l'anonimizzazione |
| Distanza percorsa per arrivare | sì (tre fasce: meno di 10 km, 10-100 km, oltre 100 km) | resta anche dopo l'anonimizzazione, per le statistiche | no, non identifica |
| Motivo della visita | sì (lista chiusa) | come la visita | no, non identifica |
| Orari di ingresso e uscita | sì | come la visita | no |
| Firma | sì | come la visita | sì (file) |
| Tipo e numero documento | solo dove attivato per il paese | come la visita | sì |
| Foto del documento | sempre insieme a tipo e numero del documento, oppure da sola dove attivata; **spenta ovunque di default** | 7 giorni | sì (file) |
| Foto del seriale del portatile | solo dove attivata (predefinito: Perù, Colombia) | 30 giorni | sì (file) |

Conservazione predefinita delle visite: Italia 90 giorni, Spagna 30, Perù e Colombia 90, altri paesi 30. Alla scadenza la visita viene **anonimizzata**: restano sede, orari e motivo per le statistiche, spariscono tutti i riferimenti alla persona. Tutti i valori sono modificabili per paese dall'amministratore del cliente e vanno validati dal DPO.

## Principi GDPR e come sono applicati

| Principio | Implementazione |
|---|---|
| Minimizzazione (art. 5.1.c) | campi facoltativi dove possibile; foto del documento disattivata di default; il server scarta i campi che la policy del paese non prevede anche se il tablet li invia; le foto vengono ridimensionate e private dei metadati EXIF (incluso GPS) sul tablet |
| Limitazione della conservazione (art. 5.1.e) | job automatico ogni 30 minuti; non dipende da procedure manuali |
| Integrità e riservatezza (art. 5.1.f, 32) | cifratura applicativa AES-256-GCM con chiavi per cliente; TLS; ruoli minimi; registro accessi |
| Trasparenza (art. 12-13) | informativa mostrata prima della firma, da scorrere fino in fondo; invio via email su richiesta; versioni immutabili: si sa esattamente quale testo ha accettato ciascun visitatore |
| Diritti dell'interessato (art. 15-17) | ricerca per email o cognome; cancellazione irreversibile dalla console con motivo e riferimento della richiesta |
| Accountability (art. 5.2) | registro accessi non modificabile dall'applicazione; documentazione delle scelte |
| Privacy by default (art. 25) | le impostazioni iniziali sono le più restrittive; ampliarle è una scelta esplicita e tracciata |

Riferimenti normativi dei modelli di informativa: GDPR e D.Lgs. 196/2003 (Italia), GDPR e LOPDGDD (Spagna), Ley 29733 (Perù), Ley 1581 de 2012 (Colombia). Per qualunque altro paese viene generato un modello con segnaposto espliciti. **I modelli sono una bozza e devono essere completati e approvati dal DPO prima dell'uso.**

## Controlli di sicurezza

**Autenticazione console.** Password con hash scrypt (N=32768); minimo 12 caratteri; cambio obbligatorio al primo accesso e dopo reset; blocco dopo 5 tentativi per 15 minuti; stesso messaggio d'errore per utente inesistente, password errata o account bloccato (nessuna enumerazione degli account); tempo di risposta costante anche per email inesistenti.

**Sessioni.** JWT firmato HS256 con emittente e destinatario verificati, in cookie `HttpOnly`, `Secure`, `SameSite=Strict`, limitato al percorso `/api` e al singolo host. Durata 8 ore. Logout, cambio password, cambio di ruolo o disattivazione revocano immediatamente tutte le sessioni dell'utente. Difesa CSRF aggiuntiva con header obbligatorio sulle richieste che modificano dati.

**Tablet.** Associazione con codice monouso di 8 caratteri valido 15 minuti; nel database c'è solo l'hash SHA-256 del codice e del token. Ogni tablet è legato a una sola sede e si può disattivare in qualsiasi momento. Dopo 90 secondi di inattività il modulo si svuota; le schermate di conferma tornano all'inizio da sole. All'uscita il tablet mostra solo "Nome I." e solo dopo che il visitatore ha digitato codice o iniziali.

**Persone da visitare.** L'elenco è gestito dall'amministratore (tutte le sedi) e dai responsabili di sede (solo le proprie). Al tablet arrivano solo nome, cognome, reparto e ruolo delle persone collegate alla sua sede: email e telefono restano nella console.

**Ruoli (minimo privilegio e separazione dei compiti).** L'Auditor ha accesso in sola lettura a tutte le sedi: vede i visitatori con documenti e immagini, esporta storico e registro accessi, ma non può registrare uscite, cancellare dati né modificare configurazioni. Ogni sua consultazione finisce nel registro accessi.

| | Amministratore | Resp. di sede | Receptionist | Auditor |
|---|---|---|---|---|
| Presenti e ingressi di oggi | tutte le sedi | sue sedi | sue sedi | tutte le sedi, sola lettura |
| Storico | completo | completo, sue sedi | ultimi 7 giorni | completo, tutte le sedi |
| Immagini (firma, foto) | sì | sì | no | sì |
| Numero documento | sì | sì | ultime 3 cifre | sì |
| Export CSV storico visite | sì | sì | no | sì |
| Export CSV registro accessi | sì | no | no | sì |
| Registrare un'uscita | sì | sì | sì | no |
| Cancellazione su richiesta | sì | sì | no | no |
| Tablet | sì | sue sedi | no | no |
| Persone da visitare | sì | sue sedi | no | no |
| Sedi, utenti, organizzazione | sì | no | no | no |
| Regole privacy e informative | modifica | lettura | no | lettura |
| Registro accessi | sì | no | no | sì |

**Registro accessi.** Registra login riusciti e falliti, ogni elenco consultato (con i filtri, ma senza il testo cercato), ogni apertura di scheda, ogni immagine vista, ogni export con numero di righe, cancellazioni con motivo, modifiche a utenti, sedi, policy e informative, esecuzioni dei job. Non contiene mai dati dei visitatori, solo identificativi. L'applicazione non offre funzioni per modificarlo o cancellarlo.

**Applicazione web.** Validazione rigorosa di ogni input con rifiuto dei campi non previsti; immagini accettate solo JPEG/PNG con verifica dei byte iniziali e limite di 3 MB; export CSV protetto da *formula injection*; header di sicurezza (CSP senza origini esterne, HSTS, `nosniff`, `no-referrer`, `frame-ancestors 'none'`, fotocamera consentita solo alla stessa origine); `Cache-Control: no-store` su tutte le risposte dell'API; rate limiting generale e più stretto su login e associazione; le query SQL non vengono mai scritte nei log, nemmeno quelle fallite; container senza privilegi di root, filesystem in sola lettura.

**Configurazione.** L'API non si avvia se mancano o sono malformati segreti e chiavi, se si tenta la sincronizzazione automatica dello schema in produzione, o se i cookie non sono `Secure` in produzione.

## Punti aperti da valutare con il DPO

1. Completare le informative (titolare, contatti, DPO) per ogni paese.
2. Confermare base giuridica e tempi di conservazione per paese.
3. **Trasferimenti internazionali:** se sedi in Perù o Colombia usano un server in UE (o viceversa), valutare gli strumenti di trasferimento previsti dalle rispettive normative.
4. Decidere se la foto del documento serve davvero in qualche paese: il numero del documento è di solito sufficiente.
5. Nel modello SaaS: il fornitore è responsabile del trattamento (art. 28) per ogni cliente; serve un accordo di trattamento dati.
6. Valutare se è necessaria una DPIA (verosimilmente no per un registro visitatori senza biometria, ma la decisione va documentata).
7. Pubblicare una nuova versione delle informative già in uso che citi la distanza percorsa e l'invio del badge di uscita via email (i modelli per i nuovi paesi sono già aggiornati).

## Requisiti applicativi verso l'infrastruttura

Espressi come necessità dell'applicazione; le scelte tecniche su come soddisfarli spettano all'infrastruttura.

1. **HTTPS** con certificato valido davanti all'applicazione (necessario per fotocamera e cookie sicuri).
2. **Un database MySQL 8 o MariaDB 10.11+** con un utente dedicato limitato al proprio schema. Consigliato: sulla tabella `audit_logs` concedere all'utente applicativo solo `INSERT` e `SELECT`.
3. **Uno spazio di archiviazione privato e persistente** per le immagini cifrate (volume o storage compatibile S3), non esposto pubblicamente.
4. **Un luogo sicuro per i segreti** (`MASTER_KEYS`, `JWT_SECRET`, password DB), separato dai backup del database: chi ha solo il backup non deve poter leggere i dati.
5. **Backup** di database e immagini secondo la politica aziendale; le copie restano cifrate.
6. **Un relay SMTP** con STARTTLS, se si vuole l'invio via email del badge di uscita e dell'informativa.
7. **Rete:** i tablet devono raggiungere l'indirizzo della console via HTTPS; nessun'altra porta è necessaria.
