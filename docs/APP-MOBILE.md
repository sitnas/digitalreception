# App mobile “Il mio badge”

App nativa per Android e iPhone (React Native + Expo, cartella `mobile/`) che sostituisce la pagina web `/badge` per i dipendenti. Usa le stesse API della pagina web, più quelle degli inviti (`/api/me`).

## Cosa fa

1. **Organizzazione**: il dipendente scrive l’indirizzo della console (es. `acme.esempio.it`). L’app accetta solo `https://` e verifica che all’indirizzo risponda davvero un server digitalreception (mostra nome e colori dell’organizzazione).
2. **Attivazione**: email di lavoro → codice di 6 cifre via email → badge attivo. Attivarlo su un nuovo telefono disattiva quello precedente.
3. **Badge**: QR che cambia ogni 30 secondi, calcolato sul telefono anche senza rete, identico a quello della pagina web; i lettori delle porte non cambiano.
4. **I miei inviti**: solo per chi in console è tra le *persone da visitare*, collegato al proprio dipendente.
   - Si crea un invito indicando ospite, sede, giorno, ora e motivo.
   - L'ospite riceve l'email con il QR, e dall'app si possono condividere codice e istruzioni.
   - Si vedono gli ospiti attesi e si annullano gli inviti.
   - Dettagli in [ACCESSI-DIPENDENTI.md](ACCESSI-DIPENDENTI.md#persone-da-visitare-e-inviti-dal-telefono).

Un link `drbadge://setup?org=acme.esempio.it` apre l’app con l’indirizzo già compilato (utile in un QR nell’email di benvenuto).

## Sicurezza

- Il segreto del badge sta solo nel portachiavi del sistema (iOS Keychain, Android Keystore), leggibile a telefono sbloccato, **mai** incluso nei backup né trasferibile su un altro telefono.
- Mentre il badge è la schermata in primo piano: schermo sempre acceso, luminosità al massimo (poi torna com’era), screenshot bloccati su Android e registrazione schermo su iOS. Nelle schermate degli inviti tutto torna normale e il telefono smette di rispondere come tessera NFC.
- Gli inviti usano un token a parte, dato all’attivazione e revocato con il telefono. Il segreto del QR non lascia mai il telefono.
- Se l’orologio del telefono differisce di oltre 20 secondi da quello del server, l’app avvisa: il lettore rifiuterebbe il QR.
- L’app non chiede permessi (niente fotocamera, posizione, contatti).

## Provarla sul telefono (senza pubblicarla)

Serve l’app **Expo Go** (gratuita, da Play Store / App Store): contiene già tutti i moduli usati.

```
cd mobile
npm ci
npx expo start --tunnel
```

Inquadra il QR che compare nel terminale con la fotocamera (iPhone) o con Expo Go (Android). Come indirizzo dell’organizzazione usa quello **https** della console. Da Codespaces l’indirizzo è quello della porta **8080** (la console, `https://<codespace>-8080.app.github.dev`), da impostare come *Public* (tasto destro sulla porta → Port Visibility → Public), altrimenti il telefono riceve la pagina di accesso di GitHub. La porta 8081 è quella di Metro: la raggiunge già il tunnel di Expo, non va toccata. Per verificare, dal browser del telefono apri l’indirizzo con `/api/tenant` in fondo: deve comparire il nome dell’organizzazione.

## Pubblicarla

Le app si compilano nel cloud con **EAS** (non servono Xcode né Android Studio):

1. Crea un account gratuito su expo.dev ed esegui `npx eas-cli@latest login` nella cartella `mobile`.
2. Prima della prima build cambia in `app.json` gli identificativi `com.digitalreception.badge` con un dominio tuo (es. `it.tuaazienda.badge`): non si possono cambiare dopo la pubblicazione.
3. Android di prova (APK da installare direttamente): `npx eas-cli@latest build --profile preview --platform android`.
4. Store: `npx eas-cli@latest build --profile production --platform all`, poi `npx eas-cli@latest submit`. Servono un account Google Play Console (25 $ una tantum) e un Apple Developer Program (99 $/anno).

## Telefono come tessera NFC (Android)

Sui telefoni Android con NFC l'app risponde anche ai lettori NFC come una tessera: basta avvicinare il retro del telefono al lettore. Il codice trasmesso è lo stesso del QR (cambia ogni 30 secondi, firmato), quindi il server non cambia.

- Funziona solo **con la schermata del badge aperta**, l'app in primo piano e il telefono **sbloccato**: in tasca o a schermo spento il telefono non risponde.
- Se l'NFC è spento, l'app mostra il pulsante *Attiva NFC* che apre le impostazioni.
- Lettori compatibili: la pagina `/reader` su un telefono o tablet Android con Chrome (Web NFC). I lettori USB "a tastiera" leggono solo il numero di serie delle tessere e **non** leggono il telefono: con quelli si usa il QR.
- **Non funziona in Expo Go**, che non contiene il codice nativo: serve l'app installata. Per provarla: `npx eas-cli@latest build --profile preview --platform android` crea un APK da installare sul telefono.
- Se sul telefono c'è un'altra app che emula tag NFC dello stesso tipo, Android può chiedere quale usare la prima volta.
- **iPhone**: Apple consente di emulare tessere solo ad app con un'autorizzazione specifica (Wallet o programma dedicato, con accordo commerciale): sull'iPhone si usa il QR.

## Limiti

- Il dipendente deve avere un'email nel sistema che manda i dati dei dipendenti (vedi `ACCESSI-DIPENDENTI.md`).

## Sviluppo

| Comando | Cosa fa |
|---|---|
| `npm run typecheck` | controllo dei tipi |
| `npm test` | test della logica del QR (stessa firma del server, formato, indirizzo) |
| `npx expo export --platform android --platform ios` | genera i bundle JavaScript: la CI lo usa per scoprire import sbagliati |

Le cartelle `ios/` e `android/` non esistono nel repository: le genera Expo al momento della build dalla configurazione in `app.json`.
