# Reception — registro visitatori multi-azienda

Registro digitale degli ingressi per le reception aziendali: il visitatore si registra da solo su un tablet, l'azienda consulta presenze e storico da una console web. Progettato per essere venduto a più aziende (multi-tenant) e per chi ha requisiti privacy stringenti: ogni dato personale è cifrato con chiavi diverse per ogni cliente, cancellato automaticamente alla scadenza e ogni consultazione è tracciata.

## Cosa fa

Sul **tablet** della reception il visitatore sceglie la lingua, inserisce i propri dati, sceglie la persona da incontrare dall'elenco della sede, indica quanta strada ha fatto per arrivare (meno di 10 km, 10-100 km, oltre 100 km), legge e accetta l'informativa privacy, firma, e riceve un codice di uscita con QR mostrato su un badge; se lascia l'email, il badge con il QR gli arriva anche per posta. Dove la policy del paese lo richiede scatta anche la foto del numero di serie del portatile, in ingresso e in uscita. All'uscita mostra il QR alla fotocamera del tablet, oppure digita il codice o le prime lettere del cognome: il tablet non mostra mai l'elenco dei presenti.

**Accessi dipendenti**: un sistema esterno (HR o controllo accessi) invia con un'API dipendenti, porte e permessi (giorni e orari). Il dipendente si presenta alla porta con il **QR sul telefono** (pagina "Il mio badge", cambia ogni 30 secondi) o con una **tessera NFC**; il lettore alla porta, un tablet o telefono Android, mostra verde o rosso e registra il passaggio. Guida, API e obblighi di legge in [docs/ACCESSI-DIPENDENTI.md](docs/ACCESSI-DIPENDENTI.md).

Gli ospiti attesi si possono **preregistrare** dalla console (pagina Inviti): ricevono un'email con un QR e all'arrivo toccano "Ho un invito" sul tablet, che compila i loro dati da solo; devono solo scegliere la distanza, leggere l'informativa e firmare. L'invito vale una sola volta, solo nel giorno previsto e nella sede indicata.

Nella **console** l'azienda vede chi è in sede adesso (elenco stampabile per l'evacuazione), consulta lo storico, esporta, cancella i dati su richiesta dell'interessato, gestisce sedi, tablet, persone da visitare, utenti, regole privacy per paese, informative versionate e il registro degli accessi. Ogni organizzazione sceglie logo e due colori (principale e secondario), applicati a tablet, console, pagina di accesso ed email del badge; il colore del testo si adatta da solo per restare leggibile. Il ruolo Auditor consulta in sola lettura tutti i visitatori di tutte le sedi, con documenti, e scarica storico e registro accessi.

## Architettura in breve

| Componente | Tecnologia | Note |
|---|---|---|
| API | NestJS 10, TypeScript, TypeORM | stateless, scalabile orizzontalmente |
| Database | MySQL 8.4 o MariaDB 10.11+ | una migrazione, testata su MariaDB |
| Frontend | React 18 + Vite, un'unica app | `/kiosk` per il tablet, `/admin` per la console |
| Immagini | volume locale oppure storage S3-compatibile (es. MinIO) | sempre cifrate prima di essere scritte |
| Email | relay SMTP aziendale | coda persistente su database |

Tutto open source, nessun servizio esterno obbligatorio e nessuna chiamata a terze parti dal browser (i font sono inclusi nell'app).

Documentazione di dettaglio:

- [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md) — scelte tecniche, multi-tenancy, scalabilità
- [docs/SICUREZZA-PRIVACY.md](docs/SICUREZZA-PRIVACY.md) — controlli di sicurezza e privacy, per CISO e DPO
- [docs/OPERAZIONI.md](docs/OPERAZIONI.md) — installazione, nuovi clienti, backup, rotazione chiavi

## Avvio rapido (un server)

```bash
cp .env.example .env
docker compose run --rm --no-deps api npm run keys   # copia MASTER_KEYS e JWT_SECRET nel .env
# completa il .env (password DB, SMTP, TENANCY_MODE...)
docker compose up -d --build
docker compose run --rm api npm run tenant -- create \
  --slug azienda --name "Azienda S.p.A." --countries IT,ES --admin-email it@azienda.com
```

L'ultimo comando stampa **una sola volta** la password temporanea del primo amministratore, da cambiare al primo accesso. Poi:

1. Console: `https://<host>/admin` → crea le sedi e gli utenti.
2. Tablet: apri `https://<host>/kiosk`, aggiungilo alla schermata Home (si apre a schermo intero), inserisci il codice generato in **Tablet → Associa un tablet**.

HTTPS è obbligatorio: senza, la fotocamera del tablet e i cookie di sessione non funzionano.

## Sviluppo locale

```bash
# API
cd api && npm ci && npm run build
cp ../.env.example .env.dev   # imposta NODE_ENV=development, COOKIE_SECURE=false, DB locale
set -a && . ./.env.dev && set +a
npm run tenant -- create --slug demo --name "Demo" --countries IT --admin-email admin@demo.test
npm start

# Web (proxy /api -> localhost:3000)
cd web && npm ci && npm run dev
```

In sviluppo `localhost` usa il tenant indicato in `DEFAULT_TENANT_SLUG`.

## Test

```bash
# API: test unitari (cifratura, CSV) + end-to-end contro un MySQL/MariaDB vero
cd api && E2E_DB_HOST=127.0.0.1 E2E_DB_USER=reception E2E_DB_PASSWORD=... npm test
# senza E2E_DB_HOST i test end-to-end vengono saltati

# Web: calcoli dei colori del brand (contrasto sempre leggibile)
cd web && npm test
```

I test end-to-end avviano l'API vera, creano un tenant temporaneo e lo eliminano alla fine: coprono ruoli e isolamento, tablet (validazioni, ricerca in uscita non enumerabile), regole privacy, statistiche e cancellazione completa del tenant. La CI su GitHub (`.github/workflows/ci.yml`) li esegue a ogni pull request e a ogni push su `main`.

## Struttura

```
api/
  src/common/        cifratura, risoluzione tenant, guard, audit, storage, lock distribuiti
  src/entities/      modello dati (ogni tabella ha tenantId)
  src/kiosk/         API del tablet
  src/admin/         API della console
  src/retention/     job di conservazione e coda email
  src/cli/           gestione clienti (creazione, sospensione, cancellazione, rotazione chiavi)
  src/database/      migrazioni, preset per paese, modelli di informativa
web/
  src/kiosk/         app del tablet (it, es, en)
  src/admin/         console (it, es)
docs/                documentazione per IT, sicurezza e privacy
```
