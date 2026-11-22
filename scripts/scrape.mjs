// Fetches every product's idealo.fr page (which lists Amazon, Fnac, Darty, Boulanger, Cdiscount…),
// appends to the price history, and sends alerts. Run: node scripts/scrape.mjs
import fs from "node:fs/promises";
import { analyze } from "../public/insights.js";
import { notify, channelCount } from "./notify.mjs";
import { parseOffers } from "./parse.mjs";

const ROOT = new URL("..", import.meta.url);
const read = async (p, fallback) => {
  try { return JSON.parse(await fs.readFile(new URL(p, ROOT), "utf8")); }
  catch (e) { if (e.code === "ENOENT" && fallback !== undefined) return fallback; throw e; }
};
const write = async (p, v) => {
  const url = new URL(p, ROOT);
  await fs.mkdir(new URL(".", url), { recursive: true });
  await fs.writeFile(url, JSON.stringify(v) + "\n");
};

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  "accept-language": "fr-FR,fr;q=0.9",
  accept: "text/html,application/xhtml+xml",
};
async function fetchHtml(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

const eur = (n) => `${Math.round(n)}€`;
const sameSnapshot = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

async function main() {
  const cfg = await read("config.json");
  const history = await read("public/data/history.json", { products: {} });
  const alertState = await read("data/alert-state.json", {});
  const now = new Date().toISOString();
  const excludeShops = cfg.excludeShops && new RegExp(cfg.excludeShops, "i");
  const excludeTitles = cfg.excludeTitles && new RegExp(cfg.excludeTitles, "i");
  const onlyShops = cfg.onlyShops && new RegExp(cfg.onlyShops, "i");
  const shopOk = (shop) => !(excludeShops?.test(shop)) && (!onlyShops || onlyShops.test(shop));
  // Drop history of shops now filtered out and of products removed from config.json, so charts and "usual" match.
  const ids = new Set(cfg.products.map((p) => p.id));
  for (const [id, h] of Object.entries(history.products)) {
    if (!ids.has(id)) { delete history.products[id]; continue; }
    for (const pt of h.points) for (const shop of Object.keys(pt.s)) if (!shopOk(shop)) delete pt.s[shop];
    h.points = h.points.filter((pt) => Object.keys(pt.s).length);
  }
  const latest = { checkedAt: now, dealThresholdPct: cfg.dealThresholdPct, products: [] };
  let failures = 0;

  if (!channelCount) console.warn("No notification channel configured: alerts will be logged only.");

  for (const p of cfg.products) {
    const meta = { id: p.id, name: p.name, url: p.url, alertBelow: p.alertBelow ?? null };
    try {
      const include = p.include && new RegExp(p.include, "i");
      const offers = parseOffers(await fetchHtml(p.url))
        .filter((o) => shopOk(o.shop) && !(excludeTitles?.test(o.title)) && (!include || include.test(o.title)))
        .sort((a, b) => a.price - b.price);
      if (!offers.length) throw new Error("no matching offers (page layout changed, or `include` filter too strict)");

      const snapshot = {};
      for (const o of offers) snapshot[o.shop] ??= o.price; // sorted, so first = cheapest per shop
      const h = (history.products[p.id] ??= { points: [] });
      if (!h.points.length || !sameSnapshot(h.points.at(-1).s, snapshot)) h.points.push({ t: now, s: snapshot });

      latest.products.push({ ...meta, offers: offers.slice(0, 20) });
      const a = analyze(h.points, Date.now(), cfg.dealThresholdPct);
      console.log(`${p.name}: ${eur(a.price)} @ ${a.shop}${a.usual ? ` (usual ${eur(a.usual)}, ${a.pct.toFixed(1)}%)` : ` (${a.days}d of history)`}`);

      // Alert once per drop: re-alert only if the price falls more than 1€ below the last alerted price;
      // reset when the condition stops holding, so the next drop alerts again.
      const st = (alertState[p.id] ??= {});
      const due = (key, cond) => {
        if (!cond) { delete st[key]; return false; }
        return st[key] === undefined || a.price < st[key] - 1;
      };
      const capDue = due("cap", p.alertBelow && a.price <= p.alertBelow);
      const dealDue = due("deal", a.isDeal);
      if (capDue || dealDue) {
        const reasons = [
          p.alertBelow && a.price <= p.alertBelow && `under your ${eur(p.alertBelow)} cap`,
          a.isDeal && `${Math.abs(a.pct).toFixed(0)}% below its usual ${eur(a.usual)}`,
          a.isLow && "lowest price tracked so far",
        ].filter(Boolean);
        const title = `${p.name}: ${eur(a.price)} at ${a.shop}`;
        const text = `${reasons.join(" · ")}.\n${offers[0].title}`;
        const site = process.env.SITE_URL ? `${process.env.SITE_URL.replace(/\/$/, "")}/#${p.id}` : null;
        console.log(`ALERT ${title} — ${text}`);
        if (channelCount && (await notify(title, text, offers[0].url ?? site)) > 0) {
          if (capDue) st.cap = a.price;
          if (dealDue) st.deal = a.price;
        }
      }
    } catch (e) {
      failures++;
      console.error(`${p.name}: FAILED — ${e.message}`);
      latest.products.push({ ...meta, error: e.message });
    }
  }

  await write("public/data/history.json", history);
  await write("public/data/latest.json", latest);
  await write("data/alert-state.json", alertState);
  if (failures === cfg.products.length) throw new Error("every product failed: idealo may be blocking this IP");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
