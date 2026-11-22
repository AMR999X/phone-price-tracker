# Phone Price Watch

Tracks phone prices across French shops (Amazon.fr, Fnac, Darty, Boulanger, Cdiscount, Kaufland, Xiaomi store…) via the
offer lists on idealo.fr. It keeps a price history per shop, works out each phone's **usual price** (30-day median), and
alerts you when a phone:

- drops to or below **your cap** (`alertBelow` in `config.json`), or
- is **≥ 7 % below its usual price** (`dealThresholdPct`), wherever that is.

The site also shows the French sales calendar (Black Friday, Christmas run-up, soldes d'hiver/d'été, French Days,
Prime Day, new Xiaomi T launches) on the chart and in a buy verdict per phone: Buy / Wait / Meh.

It runs as an **Android app** that checks prices from your phone (idealo blocks cloud servers like GitHub's, not
phones), every hour in the background, and sends normal Android notifications.

```
config.json             ← phones, caps, filters (edit this on github.com; the app downloads it each check)
android/                ← the app: background checker + notifications; its screens are public/
public/                 ← the website / app screens (static, no build step)
scripts/                ← Node versions of the scraper and tests (npm test)
PriceWatch.apk          ← the built app
```

## Install

1. On your phone, open https://github.com/AMR999X/phone-price-tracker/raw/main/PriceWatch.apk and install it
   (allow "install unknown apps" for your browser when asked).
2. Open **Price Watch**, allow notifications. It checks prices right away, then every hour.
3. **Xiaomi / POCO / Samsung phones** kill background apps: Settings → Apps → Price Watch → Battery →
   **No restrictions** (Xiaomi: also turn on **Autostart**). Otherwise checks only happen when you open the app.

Rebuild after changing the app: `cd android && ./gradlew assembleDebug` (needs the Android SDK), then copy
`android/app/build/outputs/apk/debug/app-debug.apk` to `PriceWatch.apk`. Build on the same PC each time: the
signing key lives in `~/.android/debug.keystore`, and a different key forces an uninstall (which wipes the history).

The Vercel site still works as a viewer of `public/data`, but nothing updates that data anymore (only the phone has
history now).

## Everyday use

- **Change caps / add phones**: edit `config.json` on github.com and commit. Find a phone's URL by searching on
  idealo.fr and copying the product page link (`https://www.idealo.fr/prix/<id>/<name>.html`).
- `include` is a regex the offer title must match. It keeps "17T" from matching "17T Pro" and drops accessories.
  Add a storage size to track one variant only, e.g. `"17\\s?T(?!\\s?Pro).*512"`.
- `onlyShops` keeps big French retailers (Amazon, Fnac, Darty, Boulanger, Cdiscount, brand stores…), including their
  partner sellers ("Marketplace"). Add a shop name to it to allow more. History of shops not in it is deleted on the next check.
- Alerts fire once per drop: you're re-alerted only if the price falls another 1 € or more, or after it goes back up
  and drops again.
- "Usual price" and deal alerts need 7 days of history. Cap alerts work from the first run.

## Local

```
npm test          # self-checks (calendar rules, deal maths, parser)
npm run track     # scrape now (alerts only if env vars are set)
npm run serve     # preview at http://localhost:3000
```

## If it stops working

- **Card says "Last check failed: HTTP 403"**: idealo is blocking your connection; try again on Wi-Fi vs mobile data.
- **"no matching offers"**: idealo changed its HTML. Update the 4 patterns in `scripts/parse.mjs` and the same ones in
  `android/app/src/main/java/fr/pricewatch/Tracker.java`, or your `include` regex is too strict.
