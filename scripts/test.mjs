import assert from "node:assert/strict";
import { analyze } from "../public/insights.js";
import { blackFriday, winterSales, summerSales, season } from "../public/events.js";
import { parseOffers } from "./parse.mjs";

const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// Calendar rules
assert.equal(ymd(blackFriday(2026)), "2026-11-27");
assert.equal(ymd(blackFriday(2027)), "2027-11-26");
assert.equal(ymd(winterSales(2026)), "2026-1-7");   // 2nd Wed is the 14th (>12) → 1st Wed
assert.equal(ymd(winterSales(2027)), "2027-1-6");
assert.equal(ymd(winterSales(2025)), "2025-1-8");   // 2nd Wed is the 8th
assert.equal(ymd(summerSales(2026)), "2026-6-24");
assert.equal(ymd(summerSales(2027)), "2027-6-23");  // last Wed is the 30th (>28) → one before
assert.ok(season(new Date(2026, 10, 22)).active.some((e) => e.name === "Black Friday week"));
assert.ok(season(new Date(2026, 11, 10)).active.some((e) => e.effect === "up"));

// Insights: 20 days at ~500 €, then a drop to 450 €
const DAY = 864e5, t0 = Date.UTC(2026, 9, 1);
const pts = [
  { t: new Date(t0).toISOString(), s: { A: 500, B: 520 } },
  { t: new Date(t0 + 10 * DAY).toISOString(), s: { A: 505, B: 520 } },
  { t: new Date(t0 + 20 * DAY).toISOString(), s: { A: 450, B: 520 } },
];
const a = analyze(pts, t0 + 20.5 * DAY, 7);
assert.equal(a.price, 450);
assert.equal(a.shop, "A");
assert.equal(a.usual, 500); // median of 10×500, 10×505, 1×450
assert.ok(a.isDeal && a.isLow);
assert.deepEqual(a.shopDeals.map((d) => d.shop), ["A"]);
const young = analyze(pts.slice(0, 1), t0 + 3 * DAY, 7);
assert.equal(young.usual, null);
assert.equal(young.isDeal, false);
assert.equal(analyze([], Date.now()), null);

// Parser on a minimal idealo-like block
const html = `<ul><li class="productOffers-listItem row">
  <a href="/relocator/relocate?offerKey=x&amp;price=489.99&amp;sid=1">x</a>
  <span class="productOffers-listItemTitleInner">Xiaomi 17T 256 Go &Eacute;dition</span>
  <noscript><img alt="Darty.com"/></noscript></li></ul>`;
assert.deepEqual(parseOffers(html), [{
  shop: "Darty.com", price: 489.99, title: "Xiaomi 17T 256 Go Édition",
  url: "https://www.idealo.fr/relocator/relocate?offerKey=x&price=489.99&sid=1",
}]);

console.log("all tests passed");
