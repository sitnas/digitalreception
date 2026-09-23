# Operazioni

Tutti i comandi di gestione dei clienti si eseguono dal container dell'API:

```bash
docker compose run --rm api npm run tenant -- <comando> [opzioni]
```

Non esiste una console web "di piattaforma": la gestione dei clienti avviene solo da riga di comando, così non c'è un super-utente esposto su internet.

## Nuovo cliente

```bash
npm run tenant -- create --slug acme --name "Acme S.p.A." --countries IT,ES --admin-email it@acme.com \
  --max-sites 5 --max-devices 5 --max-users 20
```

Crea il tenant con chiavi di cifratura proprie, le regole privacy dei paesi indicati, la prima versione delle informative e il primo amministratore. La password temporanea compare una sola volta: va comunicata su un canale diverso dall'email.

In modalità `subdomain` serve un record DNS (o un wildcard `*.BASE_DOMAIN`) e un certificato che copra il sottodominio.

## Altri comandi

| Comando | Effetto |
|---|---|
| `list` | clienti, stato, utilizzo rispetto ai limiti |
| `limits --slug acme --max-sites 10` | cambia i limiti del piano (`none` = illimitato) |
| `suspend --slug acme` / `activate` | blocca o riattiva l'accesso (entro 60 secondi su tutte le repliche); i dati restano e la conservazione continua |
| `delete --slug acme --confirm acme` | cancellazione definitiva con distruzione delle chiavi |
| `rewrap-keys` | dopo aver aggiunto una nuova chiave master |

Tutti i comandi scrivono un evento nel registro accessi di piattaforma.

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
- Log applicativi su stdout, senza dati personali; le esecuzioni dei job di conservazione compaiono nel log e nel registro accessi.

## Più repliche

1. `STORAGE_DRIVER=s3` (o un volume condiviso tra le repliche).
2. Tutte le repliche con le stesse variabili d'ambiente.
3. `TRUST_PROXY` uguale al numero di proxy davanti all'API, per avere gli IP corretti nel registro accessi.
4. I job girano in una sola replica alla volta grazie al lock sul database; `JOBS_ENABLED=false` li esclude da una replica specifica.
