// Fetches every product's offer list from idealo.fr (Amazon, Fnac, Darty, Boulanger, Cdiscount…), plus perfect-grade
// refurbished offers and idealo's own 1-year price history, updates the history, and sends alerts.
// Run: node scripts/scrape.mjs. The Android app runs the same logic (android/.../Tracker.java): keep them in sync.
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

// The same headers a browser sends from the product page; idealo answers 404/403 without the referer.
const headers = (referer, accept = "text/html,application/xhtml+xml,*/*;q=0.8") => ({
  "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  "accept-language": "fr-FR,fr;q=0.9",
  accept, referer,
  "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty",
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = () => sleep(1500 + Math.random() * 2500); // spread requests out: bursts get 403s

async function get(url, referer, accept, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: headers(referer, accept), signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(r.status === 403 ? "idealo a refusé la requête (HTTP 403)" : `HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (attempt >= tries) throw e.cause?.code === "ENOTFOUND" ? new Error("Pas de connexion internet pendant la vérification") : e;
      await sleep(5000 * attempt);
    }
  }
}

const idealoId = (url) => url.match(/\/prix\/(\d+)\//)?.[1];
const listUrl = (id, start, used) =>
  `https://www.idealo.fr/offerpage/offerlist/product/${id}/start/${start}/sort/default${used ? "?includeFilters=2" : ""}`;

const eur = (n) => `${Math.round(n)}€`;
const sameSnapshot = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};
const REFURB = " (Reconditionné)"; // history key suffix, so a shop's refurbished price doesn't overwrite its new one

async function main() {
  const cfg = await read("config.json");
  const history = await read("public/data/history.json", { products: {} });
  const alertState = await read("data/alert-state.json", {});
  const prev = await read("public/data/latest.json", { products: [] });
  const now = new Date().toISOString();
  const re = (s) => s && new RegExp(s, "i");
  const excludeShops = re(cfg.excludeShops), excludeTitles = re(cfg.excludeTitles), onlyShops = re(cfg.onlyShops);
  const usedWords = re(cfg.usedWords), refurbOk = re(cfg.refurbOk);
  const shopOk = (shop) => { const s = shop.replace(REFURB, ""); return !(excludeShops?.test(s)) && (!onlyShops || onlyShops.test(s)); };
  // Drop history of shops now filtered out and of products removed from config.json, so charts and "usual" match.
  const ids = new Set(cfg.products.map((p) => p.id));
  for (const [id, h] of Object.entries(history.products)) {
    if (!ids.has(id)) { delete history.products[id]; continue; }
    for (const pt of h.points) for (const shop of Object.keys(pt.s)) if (!shopOk(shop)) delete pt.s[shop];
    h.points = h.points.filter((pt) => Object.keys(pt.s).length);
  }
  const latest = { checkedAt: now, okAt: prev.okAt ?? null, dealThresholdPct: cfg.dealThresholdPct, products: [] };
  let failures = 0;
  let historyBudget = 3; // idealo rate-limits its history endpoint: a few per run, the rest fill in over the next hours

  if (!channelCount) console.warn("No notification channel configured: alerts will be logged only.");

  for (const p of cfg.products) {
    const meta = { id: p.id, name: p.name, url: p.url, alertBelow: p.alertBelow ?? null };
    const h = (history.products[p.id] ??= { points: [] });
    try {
      const id = idealoId(p.url);
      if (!id) throw new Error("adresse idealo invalide dans config.json");
      const include = re(p.include);

      const raw = [];
      for (const start of [0, 20]) {
        const page = parseOffers(await get(listUrl(id, start), p.url));
        raw.push(...page.map((o) => ({ ...o, cond: "neuf" })));
        await pause();
        if (page.length < 20) break;
      }
      for (const o of parseOffers(await get(listUrl(id, 0, true), p.url))) raw.push({ ...o, cond: "reconditionné" });
      await pause();

      const seen = new Set();
      const offers = raw
        .filter((o) => !seen.has(o.url ?? o.title + o.price) && seen.add(o.url ?? o.title + o.price))
        .filter((o) => shopOk(o.shop) && !(excludeTitles?.test(o.title)) && (!include || include.test(o.title)))
        // new list: no used/refurb wording; refurbished list: only perfect grades
        .filter((o) => (o.cond === "neuf" ? !(usedWords?.test(o.title)) : !!refurbOk?.test(o.title)))
        .sort((a, b) => a.price - b.price);
      if (!offers.length) throw new Error("aucune offre correspondante (page idealo modifiée, ou filtre `include` trop strict)");

      const snapshot = {};
      for (const o of offers) snapshot[o.shop + (o.cond === "neuf" ? "" : REFURB)] ??= o.price; // sorted: first = cheapest
      if (!h.points.length || !sameSnapshot(h.points.at(-1).s, snapshot)) h.points.push({ t: now, s: snapshot });

      // idealo's own daily best price over a year (all sellers, not just trusted ones), refreshed once a day.
      if (historyBudget > 0 && (!h.idealo || Date.now() - Date.parse(h.idealo.fetchedAt) > 20 * 36e5)) {
        historyBudget--;
        try {
          const j = JSON.parse(await get(`https://www.idealo.fr/price-chart/sites/4/products/${id}/history?period=1Y`, p.url, "application/json, text/plain, */*", 1));
          h.idealo = { fetchedAt: now, points: j.data.map((d) => [d.x, d.y / 100]) };
          await pause();
        } catch (e) { historyBudget = 0; console.warn(`${p.name}: idealo history refused (${e.message}), retrying next run`); }
      }

      latest.products.push({ ...meta, okAt: now, offers: offers.slice(0, 30) });
      latest.okAt = now;
      const a = analyze(h.points, Date.now(), cfg.dealThresholdPct);
      console.log(`${p.name}: ${eur(a.price)} @ ${a.shop} · ${offers.length} offers${a.usual ? ` (usual ${eur(a.usual)}, ${a.pct.toFixed(1)}%)` : ` (${a.days}d of history)`}${h.idealo ? ` · idealo ${h.idealo.points.length} days` : ""}`);

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
          p.alertBelow && a.price <= p.alertBelow && `sous ton plafond de ${eur(p.alertBelow)}`,
          a.isDeal && `${Math.abs(a.pct).toFixed(0)} % sous son prix habituel de ${eur(a.usual)}`,
          a.isLow && "prix le plus bas relevé",
        ].filter(Boolean);
        const title = `${p.name} : ${eur(a.price)} chez ${a.shop}`;
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
      // Keep the last good offers on screen, flagged with the error and when they were fetched.
      const old = prev.products.find((x) => x.id === p.id);
      latest.products.push({ ...meta, error: e.message, okAt: old?.okAt ?? null, offers: old?.offers ?? [] });
    }
  }

  await write("public/data/history.json", history);
  await write("public/data/latest.json", latest);
  await write("data/alert-state.json", alertState);
  if (failures === cfg.products.length) throw new Error("every product failed: idealo may be blocking this IP");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
