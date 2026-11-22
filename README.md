# Phone Price Watch

Tracks phone prices across French shops (Amazon.fr, Fnac, Darty, Boulanger, Cdiscount, Kaufland, Xiaomi store…) via the
offer lists on idealo.fr. It keeps a price history per shop, works out each phone's **usual price** (30-day median), and
alerts you when a phone:

- drops to or below **your cap** (`alertBelow` in `config.json`), or
- is **≥ 7 % below its usual price** (`dealThresholdPct`), wherever that is.

The site also shows the French sales calendar (Black Friday, Christmas run-up, soldes d'hiver/d'été, French Days,
Prime Day, new Xiaomi T launches) on the chart and in a buy verdict per phone: Buy / Wait / Meh.

```
config.json             ← phones, caps, filters (edit this)
scripts/scrape.mjs      ← fetch prices, update history, send alerts
scripts/notify.mjs      ← ntfy / Discord / SMS / email
public/                 ← the website (static, no build step)
public/data/*.json      ← price history (written by the scraper)
.github/workflows/      ← runs the scraper every 3 hours
```

## Setup (about 15 min)

1. **Put it on GitHub.** Create an empty repo on github.com, then:
   ```
   git remote add origin https://github.com/<you>/phone-price-tracker.git
   git push -u origin main
   ```
2. **Host the site.** Either
   - **Vercel**: "Add New Project", import the repo, Framework preset **Other**, Output directory **`public`**. Every
     data commit redeploys automatically. Or
   - **GitHub Pages**: Settings → Pages → Deploy from branch `main`, folder `/` won't work, so prefer Vercel.
3. **Turn on alerts** in the repo's Settings → Secrets and variables → Actions → *New repository secret*. Set any of these:

   | Channel | Secrets | Notes |
   |---|---|---|
   | **Phone push (recommended)** | `NTFY_TOPIC` | Install the free **ntfy** app, subscribe to a long random topic like `prix-tel-8f3k2q9x`, and put the same name here. Free, instant. |
   | SMS (Free Mobile) | `FREE_MOBILE_USER`, `FREE_MOBILE_PASS` | Free if you're a Free Mobile customer: Espace abonné → Mes options → *Notifications par SMS*. |
   | SMS (any operator) | `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `ALERT_PHONE` | Twilio, paid (~0.08 €/SMS). `ALERT_PHONE` like `+33612345678`. |
   | Discord | `DISCORD_WEBHOOK_URL` | Channel settings → Integrations → Webhooks → copy URL. |
   | Email | `RESEND_API_KEY`, `ALERT_EMAIL` | resend.com free tier; without your own domain it only sends to your sign-up address. |

   Optional *variable* (not secret) `SITE_URL` = your Vercel URL.
4. **Run it once**: Actions tab → *Track prices* → *Run workflow*. After that it runs every 3 hours.

## Everyday use

- **Change caps / add phones**: edit `config.json` on github.com and commit. Find a phone's URL by searching on
  idealo.fr and copying the product page link (`https://www.idealo.fr/prix/<id>/<name>.html`).
- `include` is a regex the offer title must match. It keeps "17T" from matching "17T Pro" and drops accessories.
  Add a storage size to track one variant only, e.g. `"17\\s?T(?!\\s?Pro).*512"`.
- `excludeShops` drops AliExpress/OnBuy by default (import versions, no French warranty). Remove it to include them.
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

- **Card says "Last check failed: HTTP 403"**: idealo is blocking GitHub's servers. Run `npm run track` from your PC
  on a schedule instead (Windows Task Scheduler), then `git push`.
- **"no matching offers"**: idealo changed its HTML. Update the 4 patterns in `scripts/parse.mjs`, or your `include`
  regex is too strict.
