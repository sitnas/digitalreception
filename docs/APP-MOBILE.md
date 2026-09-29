# App mobile “Il mio badge”

App nativa per Android e iPhone (React Native + Expo, cartella `mobile/`) che sostituisce la pagina web `/badge` per i dipendenti. Usa le stesse API del server: nessuna modifica lato server.

## Cosa fa

1. **Organizzazione**: il dipendente scrive l’indirizzo della console (es. `acme.esempio.it`). L’app accetta solo `https://` e verifica che all’indirizzo risponda davvero un server digitalreception (mostra nome e colori dell’organizzazione).
2. **Attivazione**: email di lavoro → codice di 6 cifre via email → badge attivo. Attivarlo su un nuovo telefono disattiva quello precedente.
3. **Badge**: QR che cambia ogni 30 secondi, calcolato sul telefono anche senza rete, identico a quello della pagina web; i lettori delle porte non cambiano.

Un link `drbadge://setup?org=acme.esempio.it` apre l’app con l’indirizzo già compilato (utile in un QR nell’email di benvenuto).

## Sicurezza

- Il segreto del badge sta solo nel portachiavi del sistema (iOS Keychain, Android Keystore), leggibile a telefono sbloccato, **mai** incluso nei backup né trasferibile su un altro telefono.
- Mentre il badge è aperto: schermo sempre acceso, luminosità al massimo (poi torna com’era), screenshot bloccati su Android e registrazione schermo su iOS.
- Se l’orologio del telefono differisce di oltre 20 secondi da quello del server, l’app avvisa: il lettore rifiuterebbe il QR.
- L’app non chiede permessi (niente fotocamera, posizione, contatti).

## Provarla sul telefono (senza pubblicarla)

Serve l’app **Expo Go** (gratuita, da Play Store / App Store): contiene già tutti i moduli usati.

```
cd mobile
npm ci
npx expo start --tunnel
```

Inquadra il QR che compare nel terminale con la fotocamera (iPhone) o con Expo Go (Android). Come indirizzo dell’organizzazione usa quello **https** della console. Da Codespaces: la porta 5173 deve essere impostata come *Public* (tasto destro sulla porta → Port Visibility → Public), altrimenti il telefono riceve la pagina di accesso di GitHub.

## Pubblicarla

Le app si compilano nel cloud con **EAS** (non servono Xcode né Android Studio):

1. Crea un account gratuito su expo.dev ed esegui `npx eas-cli@latest login` nella cartella `mobile`.
2. Prima della prima build cambia in `app.json` gli identificativi `com.digitalreception.badge` con un dominio tuo (es. `it.tuaazienda.badge`): non si possono cambiare dopo la pubblicazione.
3. Android di prova (APK da installare direttamente): `npx eas-cli@latest build --profile preview --platform android`.
4. Store: `npx eas-cli@latest build --profile production --platform all`, poi `npx eas-cli@latest submit`. Servono un account Google Play Console (25 $ una tantum) e un Apple Developer Program (99 $/anno).

## Limiti

- **Telefono come tessera NFC**: non ancora. Su Android è possibile in futuro (emulazione di tessera, HCE) con un modulo nativo dedicato; su iPhone Apple lo consente solo ad app autorizzate tramite Wallet. Il QR funziona su entrambi.
- Il dipendente deve avere un’email nel sistema che manda i dati dei dipendenti (vedi `ACCESSI-DIPENDENTI.md`).

## Sviluppo

| Comando | Cosa fa |
|---|---|
| `npm run typecheck` | controllo dei tipi |
| `npm test` | test della logica del QR (stessa firma del server, formato, indirizzo) |
| `npx expo export --platform android --platform ios` | genera i bundle JavaScript: la CI lo usa per scoprire import sbagliati |

Le cartelle `ios/` e `android/` non esistono nel repository: le genera Expo al momento della build dalla configurazione in `app.json`.
