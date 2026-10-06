# Roadmap

Ottobre 2026. Cosa resta da fare, in ordine. Prima il lavoro di sviluppo, poi le attività che non sono codice (prove, verifiche esterne, decisioni). Le sigle M1, B3… sono quelle dell'[audit CISO](AUDIT-CISO.md).

Le stime sono giornate di sviluppo e test di una persona, revisione esclusa. Quando una voce è fatta, si segna qui con il numero della PR.

## Sviluppo

### P1 — Sicurezza, interventi piccoli

Prima di tutto, perché costano poco e sono le prime domande di un CISO.

| # | Intervento | Perché | Dove | Stima | Stato |
|---|---|---|---|---|---|
| 1 | **QR del badge monouso per porta** (M1), più anti-passback facoltativo per porta | Oggi uno screenshot girato a un collega apre la porta per circa 90 secondi | `api/src/access/access.service.ts`, una tabella dei codici usati che scade dopo 2 minuti | 2-3 g | da fare |
| 2 | **Timeout per inattività della console** (B3), configurabile, di default 30 minuti | Un PC della reception lasciato aperto resta collegato per 8 ore | sessione in `api/src/auth`, avviso in console prima della scadenza | 0,5 g | da fare |
| 3 | **Ritardo crescente al posto del blocco fisso** (M5) | Chi conosce l'email di un amministratore può tenerlo fuori a ripetizione | `api/src/auth` | 1 g | da fare |
| 4 | **Verifica in due passaggi obbligatoria** per Amministratore e Auditor senza SSO (B1) | L'Auditor vede documenti e foto dei visitatori con la sola password | `api/src/auth`, impostazione in Organizzazione | 0,5 g | da fare |
| 5 | **Limite del corpo per rotta** (B4): 12 MB solo per il tablet, 100 KB per il resto | Anche le rotte senza login accettano 12 MB | `api/src/main.ts` | 0,5 g | da fare |
| 6 | **Scansioni in CI** (M3): `npm audit` bloccante sulle alte, CodeQL o Semgrep, gitleaks, SBOM | Oggi gli avvisi si vedono solo lanciando il controllo a mano | `.github/workflows/ci.yml` | 1 g | da fare |

### P2 — Prodotto: funzioni che mancano a chi lo usa ogni giorno

| # | Intervento | Perché | Stima | Stato |
|---|---|---|---|---|
| 7 | **Promemoria del parcheggio la sera prima**, con push: "domani hai il posto P3, se non vieni liberalo" | Senza promemoria i posti prenotati e non usati restano bloccati | 1 g | da fare |
| 8 | **Check-out automatico a fine giornata**, all'ora di chiusura della sede | Chi dimentica il check-out resta tra i presenti: la lista dell'evacuazione si sporca e diventa più lenta ([CARICO.md](CARICO.md)) | 1 g | da fare |
| 9 | **Avviso all'host se l'ospite invitato non arriva** entro un'ora dall'orario previsto | L'host lo scopre solo chiamando la reception | 1 g | da fare |
| 10 | **Lista d'attesa del parcheggio** per i giorni pieni, con notifica quando un posto si libera | Oggi chi trova "Completo" deve tornare a guardare | 2 g | da fare |
| 11 | **Report periodico via email** ai responsabili: visite, passaggi, uso dei parcheggi della settimana o del mese | È quello che chiede chi paga, e oggi si ottiene solo esportando a mano | 2-3 g | da fare |

### P3 — Aggiornamenti e infrastruttura

| # | Intervento | Perché | Stima | Stato |
|---|---|---|---|---|
| 12 | **Dipendenze** (M2): NestJS 12, react-router, SDK Expo | Avvisi noti, nessuno critico né raggiungibile, ma vanno chiusi | 3-5 g | da fare |
| 13 | **Chiavi master in un KMS** (M4): AWS KMS, Azure Key Vault o Vault | Chi legge l'ambiente del container può decifrare tutto | 3-4 g per un fornitore | da fare |
| 14 | **Lista dei presenti paginata** | Costa circa 0,13 ms per ospite: va bene per ogni reception reale, ma è l'unica schermata che cresce con i dati | 1 g | quando serve |

### P4 — Prima del primo cliente regolato (NIS2, DORA)

| # | Intervento | Stima | Stato |
|---|---|---|---|
| 15 | **Invio del registro accessi a un SIEM** (I1): syslog o webhook firmato, formato documentato | 2-3 g | da pianificare |
| 16 | **Chiavi API di integrazione con scadenza ed elenco di IP ammessi** (B2) | 1 g | da pianificare |
| 17 | **Badge solo da app per le porte sensibili** (B5): `/badge` tiene il segreto nel browser | 1 g | da pianificare |

## Fuori dal codice

| Attività | Perché | Chi | Quando |
|---|---|---|---|
| **Prova su dispositivi veri**: tablet in reception, telefono come lettore, app sul telefono (calendario del parcheggio, NFC, push su Android con una build EAS) | Queste parti non sono mai state provate su un dispositivo fisico | team | subito, in parallelo a P1 |
| **Ripristino da backup provato da zero** e invio email con un SMTP vero | La procedura è scritta in [OPERAZIONI.md](OPERAZIONI.md) ma non è mai stata eseguita | operazioni | prima del primo cliente |
| **Test di carico su hardware reale** con gli script di `load/` | Il test di ottobre girava tutto su una macchina da 4 core | operazioni | prima di un'offerta SaaS |
| **Penetration test esterno** (I2) sull'installazione reale, proxy e TLS compresi | L'audit ha letto il codice; da fuori non ha provato nessuno | fornitore esterno | prima del primo cliente in produzione |
| **Decisioni di design**: palette Mortise, angoli delle card (22 px o 4 px), cosa indica la data sulle card | Bloccano la chiusura delle linee guida delle card | design | da fissare |

## Ordine consigliato

1. P1 nell'ordine della tabella. Il QR monouso e il timeout si fanno nella stessa settimana della prova su dispositivi veri.
2. Dalla P2, prima il promemoria del parcheggio e il check-out automatico (un giorno ciascuno), poi il resto.
3. P3 a blocchi, in settimane senza rilasci di funzioni: gli aggiornamenti di versione vanno provati da soli.
4. P4 e il penetration test quando c'è un cliente regolato in vista.
