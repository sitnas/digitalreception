---
name: anti-ai-slop-writing
description: Scrive testi che non suonano generati da un'IA, in italiano, spagnolo e inglese. Si attiva per ogni testo destinato a persone in questo progetto — stringhe della console, del tablet, dell'app e della pagina badge, email a visitatori e dipendenti, documentazione (README, docs/), descrizioni di PR e commit, risposte all'utente in chat. Applica vocabolario vietato, varietà strutturale, disciplina della punteggiatura, regole di accuratezza e tono. Usala quando l'utente dice "scrivi", "riscrivi", "umanizza", "rendilo naturale", "non sembri IA", "anti-slop", o quando tocchi testi visibili.
---

# Scrittura senza "AI slop"

Ogni testo che finisce davanti a una persona (receptionist, visitatore, dipendente, amministratore, chi legge il codice) deve suonare scritto da qualcuno che conosce il prodotto e ha fretta di farsi capire. Vale in italiano, spagnolo e inglese.

## Prima di scrivere

Carica l'elenco in [references/parole-vietate.md](references/parole-vietate.md) e non usare nessuna di quelle parole o formule. Se te ne viene una, sostituiscila con qualcosa di concreto oppure rifai la frase.

## Dove si applica e come cambia

| Contesto | File tipici | Regola in più |
|---|---|---|
| Interfaccia (console, tablet, app, /badge) | `web/src/admin/i18n.tsx`, `web/src/kiosk/strings.ts`, `mobile/src/lib/i18n.ts`, `web/src/access/*` | Pulsanti = verbo d'azione ("Salva", "Crea invito"), mai "Procedi"/"Conferma operazione". Gli errori dicono cosa fare dopo, non solo cosa è andato storto. Niente punti esclamativi. |
| Email a visitatori e dipendenti | `api/src/common/mail.service.ts` | Chi scrive, cosa deve fare la persona, entro quando. Niente "Gentile utente". |
| Documentazione | `README.md`, `docs/*.md` | Comandi copiabili, nomi veri di file e variabili, cosa succede se va male. |
| PR e commit | descrizioni GitHub | Cosa cambia e perché, poi come è stato provato con numeri veri (test passati, schermate). |
| Risposte in chat all'utente | — | Italiano diretto, frasi brevi ma collegate, comandi in blocchi di codice, nessun preambolo. |

Registro nell'interfaccia: **italiano con il "tu"** (come il resto della console e dell'app), **spagnolo con "usted"**, inglese neutro. Non cambiare registro dentro la stessa schermata.

## Regole di struttura

**Niente regola del tre.** L'IA raggruppa tutto a tre. Usa due, quattro, uno. Tre solo quando le cose sono davvero tre.

**Lunghezza delle frasi variata.** Mai tre frasi di fila della stessa lunghezza. Alterna una frase di quattro parole a una di trenta.

**Niente paratassi a raffica.** "Frase breve. Poi un'altra. Poi un'altra." suona da IA. Collega le idee con congiunzioni, subordinate, punto e virgola: mostra causa, contrasto, condizione ("perché", "ma", "così", "se").

**Niente altalena di cautele.** Scegli una posizione e dilla. Le obiezioni, se servono, in una frase.

**Niente tono da motivatore aziendale.** Scrivi come chi il problema l'ha avuto davvero, anche nelle parti noiose.

**Paragrafi diversi tra loro.** Non sempre frase tematica → spiegazione → esempio → transizione. Alcuni paragrafi sono una riga, altri finiscono senza raccordo.

**Elenchi puntati con parsimonia.** Al massimo 5-7 voci, di lunghezza diversa. Se sta in una frase, scrivi la frase. Nelle istruzioni passo-passo l'elenco numerato va bene.

**Niente "In qualità di…".** Si dice la cosa, senza presentarsi.

**Forma attiva.** "Il sistema cancella i dati dopo 30 giorni", non "I dati vengono cancellati". Il passivo è ammesso quando chi agisce non conta davvero.

**Si può chiudere di colpo.** Non serve il riassunto in fondo a ogni paragrafo.

## Punteggiatura

- **Trattino lungo (—):** al massimo uno ogni 500 parole; nelle stringhe dell'interfaccia, zero. Usa virgola, due punti, punto e virgola, parentesi.
- **Punto esclamativo:** al massimo uno ogni 1000 parole; nell'interfaccia, mai.
- **Puntini di sospensione:** solo se il discorso resta davvero sospeso, al massimo uno per testo. Mai come transizione.
- **Punto e virgola:** usalo; chi scrive bene lo usa e l'IA lo evita.
- **Due punti:** per annunciare qualcosa che poi arriva davvero.

## Cosa fare invece

- **Specifico, non generico.** "Il QR cambia ogni 30 secondi, quindi uno screenshot smette di funzionare" batte "sicurezza avanzata".
- **Mostra, non descrivere.** "Tre tocchi dall'apertura dell'app al QR" batte "un'esperienza fluida".
- **Numeri veri.** "29 test passati, 0 falliti" batte "test completi". Se non hai il numero, non inventarlo.
- **Nomi veri.** "Microsoft Entra ID o Google Workspace", "porta 8080", "`docker-compose.codespaces.yml`" invece di "vari provider", "la porta giusta", "il file di configurazione".
- **Ammetti l'attrito.** "Su iPhone l'NFC non è disponibile: Apple non lo permette alle app" batte il silenzio o un giro di parole.
- **Elisioni e forme parlate** dove il registro lo permette ("l'ospite", "c'è", "dov'è"); in inglese le contrazioni ("don't", "it's").
- **Contesto concreto:** quando, dove, con che cosa ("dopo il `git pull`", "nel terminale del Codespace").
- **La parola meno ovvia.** La prima parola che viene in mente è spesso quella più probabile per un modello; cerca quella più precisa.
- **Mai inventare aneddoti o casi** e presentarli come veri. Gli esempi ipotetici si dichiarano ("per esempio", "immagina che").

## Accuratezza

- Mai inventare dati, statistiche, versioni, risultati di test. Se non l'hai verificato, dillo ("non l'ho provato su un telefono vero").
- Mai attribuire citazioni inventate.
- Posizioni nette quando le prove ci sono; cautela solo per incertezza reale.
- Nomi, aziende, date, comandi devono essere verificabili nel repository o nella sessione.

## Formattazione

- **Interfaccia ed email:** niente markdown, niente grassetti, niente emoji.
- **Chat con l'utente:** titoletti in grassetto solo se la risposta ha più passaggi; niente intestazioni `#`; blocchi di codice per ogni comando.
- **Documentazione:** intestazioni sì, ma senza titoli tutti uguali; tabelle solo quando confrontano davvero qualcosa.
- Niente emoji come punti elenco, niente pile di hashtag, niente "🧵".

## Tono

Quando scrivi per l'utente di questo progetto: diretto, informale, in italiano, frasi che vanno al punto, fiducia nel lettore. Non spiegare due volte. Non chiudere con "Fammi sapere se hai bisogno di altro".

Per i testi rivolti ai visitatori: cortese ma asciutto; chi è alla reception ha la giacca in mano e vuole entrare.

## Controllo prima di consegnare

1. Parole o formule vietate? → Sostituisci.
2. Tre frasi di fila della stessa lunghezza? → Varia.
3. Tre o più frasi brevi slegate di fila? → Collegale.
4. Raggruppato a tre per abitudine? → Rompi lo schema.
5. Cautele invece di una posizione? → Scegli.
6. Più di un trattino lungo (nessuno nell'interfaccia)? → Toglilo.
7. Passivo evitabile? → Rendilo attivo.
8. Ogni paragrafo chiude con una transizione? → Tagliane qualcuna.
9. Dettagli inventati? → Togli o dichiara come ipotesi.
10. Lo stesso testo andrebbe bene per qualsiasi prodotto? → Aggiungi un dettaglio di questo.
11. Registro coerente (tu / usted) in tutta la schermata?
12. Suona come ChatGPT? → Riscrivi finché la risposta è no.

Applica queste regole in silenzio. Non citarle e non dire "secondo le linee guida": scrivi e basta.
