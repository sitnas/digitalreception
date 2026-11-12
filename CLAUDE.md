# Mortise: istruzioni per Claude Code

Piattaforma multi-cliente per reception, accessi dei dipendenti, pacchi e parcheggi.
- `api/`: NestJS + TypeORM, MariaDB/MySQL
- `web/`: React + Vite, console `/admin`, tablet `/kiosk`, `/badge`, `/reader`
- `mobile/`: app Expo "Il mio badge"
- `docs/`: documentazione; cosa resta da fare è in `docs/ROADMAP.md`

## Regole fisse

- Rispondi all'utente in italiano, con la skill `anti-ai-slop-writing` per ogni testo destinato a persone.
- Docker in Codespaces sempre con `-f docker-compose.codespaces.yml`. Mai consigliare `docker compose down -v`, `docker volume prune` o `docker system prune --volumes`: cancellano database e file.
- Mai `npm audit fix --force` in `mobile/`.
- Non modificare a mano il database dell'utente: solo query di lettura.
- L'API di integrazione resta solo in ingresso: Mortise non chiama i sistemi HR dei clienti.
- Nessun identificativo del modello in commit, PR o codice.
- Prima di un commit: `git checkout web/tsconfig.tsbuildinfo` se risulta modificato.
- Non chiedere né accettare in chat chiavi, password o token.

## Agenti

In `.claude/agents/` ci sono sei agenti:

| Agente | Ruolo | Modifica file |
|---|---|---|
| `api` | backend | sì |
| `web` | frontend web | sì |
| `mobile` | app Expo | sì |
| `docs` | testi e documentazione; revisore dei testi | sì quando scrive, no quando revisiona |
| `reviewer` | revisore del codice | no |
| `security` | revisore di sicurezza | no |

La sessione principale fa da **coordinatore**:
- divide il compito;
- lo assegna agli agenti autori;
- fa partire le revisioni;
- fa commit, PR e merge.

Gli agenti non fanno commit né push.

## Revisione tra agenti

Nessuna modifica arriva a una PR senza l'approvazione di almeno un agente diverso da quello che l'ha scritta.

### 1. Chi revisiona cosa

| La modifica tocca | Revisori obbligatori |
|---|---|
| qualunque codice | `reviewer` |
| `api/src/auth`, `api/src/access`, guard, cifratura, token, ruoli, migrazioni, endpoint senza login, dati di visitatori o dipendenti | `reviewer` + `security` |
| stringhe dell'interfaccia, email, `docs/`, README | `docs` (in modalità revisione) |
| la forma di una risposta dell'API usata da web o mobile | `reviewer`, più l'agente dell'altra parte (`web` o `mobile`) in modalità revisione, solo per il contratto |

Un agente non revisiona mai il proprio lavoro. Le revisioni indipendenti tra loro partono in parallelo.

### 2. Cosa riceve il revisore

Il coordinatore passa al revisore:
- il compito originale;
- l'elenco dei file cambiati;
- l'output di `git diff`;
- il riepilogo dell'autore: comandi lanciati e dubbi.

Il revisore parte senza memoria della conversazione: tutto quello che gli serve deve essere nel messaggio.

### 3. Formato della risposta del revisore

```
ESITO: APPROVATO | DA CORREGGERE

RILIEVI
1. [bloccante | da correggere | nit] file:riga — cosa non va
   Scenario: input o situazione → risultato sbagliato
   Correzione proposta: …

VERIFICHE FATTE
- comando → esito
```

Gravità:
- **bloccante**: bug, dati di un cliente visibili a un altro, falla di sicurezza, test che fallisce, rottura delle app installate;
- **da correggere**: errore reale ma circoscritto, test mancante per un comportamento nuovo, testo sbagliato o mancante in una lingua;
- **nit**: stile, nomi, piccole semplificazioni.

L'esito è APPROVATO solo se non ci sono rilievi bloccanti né da correggere. I rilievi vanno verificati nel codice o con un comando: niente "potrebbe forse".

### 4. Correzioni e giri successivi

1. Il coordinatore passa i rilievi all'agente autore, che corregge i bloccanti e quelli da correggere. I nit li applica se costano poco, altrimenti spiega perché no.
2. Lo stesso revisore ricontrolla solo le parti cambiate.
3. Al massimo **3 giri** per revisore. Se dopo il terzo restano rilievi bloccanti, il coordinatore si ferma e chiede all'utente, riassumendo il disaccordo.
4. Se autore e revisore non sono d'accordo su un rilievo, decide l'utente, non il coordinatore.

### 5. Dopo l'approvazione

Quando tutti i revisori obbligatori hanno risposto APPROVATO, il coordinatore:
1. lancia di nuovo i controlli delle parti toccate;
2. fa il commit e apre la PR, con una sezione **Revisioni** nella descrizione:
   ```
   ## Revisioni
   - reviewer: APPROVATO al giro 2 (corretti: limite su tutta la richiesta, test mancante)
   - security: APPROVATO al giro 1
   - docs: APPROVATO al giro 1 (nit non applicato: …)
   ```
3. aspetta la CI verde e fa il merge.

### Controlli per parte

| Parte | Comandi |
|---|---|
| api | `cd api && npm run build && E2E_DB_HOST=127.0.0.1 npm test` (serve MariaDB) |
| web | `cd web && npx tsc --noEmit -p . && npm test && npm run build` |
| mobile | `cd mobile && npm run typecheck && npm test` |
