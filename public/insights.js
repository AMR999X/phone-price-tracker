// Shared by the scraper (alerts) and the website (cards/charts), so both judge "a deal" the same way.
// history points: [{ t: ISO date, s: { shopName: price } }] — each point is a full snapshot, stored only when something changed.
const DAY = 864e5;

export const bestOf = (s) => {
  let best = null;
  for (const [shop, price] of Object.entries(s)) if (!best || price < best.price) best = { shop, price };
  return best;
};

export function stateAt(points, t) {
  let s = null;
  for (const p of points) {
    if (Date.parse(p.t) > t) break;
    s = p.s;
  }
  return s;
}

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// "Usual" price = median of the daily best price over the last `windowDays`, once we have >= 7 days of data.
export function analyze(points, now = Date.now(), dealPct = 7, windowDays = 30) {
  if (!points?.length) return null;
  const last = points.at(-1).s;
  const cur = bestOf(last);
  if (!cur) return null;
  const first = Date.parse(points[0].t);
  const days = Math.floor((now - first) / DAY);

  const daily = [], perShop = {};
  for (let t = Math.max(first, now - windowDays * DAY); t <= now; t += DAY) {
    const s = stateAt(points, t);
    if (!s || !Object.keys(s).length) continue;
    daily.push(bestOf(s).price);
    for (const [shop, price] of Object.entries(s)) (perShop[shop] ??= []).push(price);
  }

  let low = null;
  for (const p of points) {
    const b = bestOf(p.s);
    if (b && (!low || b.price < low.price)) low = { ...b, t: p.t };
  }

  const enough = days >= 7;
  const usual = enough ? median(daily) : null;
  const pct = usual ? ((cur.price - usual) / usual) * 100 : null;
  const shopDeals = !enough ? [] : Object.entries(last).flatMap(([shop, price]) => {
    const xs = perShop[shop];
    if (!xs || xs.length < 7) return [];
    const u = median(xs), d = ((price - u) / u) * 100;
    return d <= -dealPct ? [{ shop, price, usual: u, pct: d }] : [];
  });

  return {
    ...cur, usual, pct, days, low, shopDeals,
    isDeal: pct !== null && pct <= -dealPct,
    isLow: enough && cur.price <= low.price * 1.01,
  };
}
