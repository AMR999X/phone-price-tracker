import { analyze, bestOf } from "./insights.js";
import { season, daysUntil } from "./events.js";

const $ = (s) => document.querySelector(s);
const DAY = 864e5;
const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format;
const eurC = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format;
const dShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format;
const dLong = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pctTxt = (p) => `${p > 0 ? "+" : "−"}${Math.abs(p).toFixed(0)}%`;
const ago = (t) => {
  const h = (Date.now() - t) / 36e5;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};

const load = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const [latest, history] = await Promise.all([load("data/latest.json"), load("data/history.json")]);
const now = Date.now();
const sea = season(new Date());

// ---------- Season banner ----------
function renderSeason() {
  const live = sea.active.map((e) => `
    <div class="ev ev-live ev-${e.effect}">
      <span class="ev-tag">Now</span>
      <div><strong>${esc(e.name)}</strong> <span class="muted">until ${dShort(e.end)}${e.approx ? " (approx.)" : ""}</span>
      <p>${esc(e.tip)}</p></div>
    </div>`).join("");
  const next = sea.next.map((e) => {
    const n = daysUntil(e.start);
    return `<li class="ev-${e.effect}"><span class="arrow" aria-hidden="true">${e.effect === "down" ? "↘" : "↗"}</span>
      <span>${esc(e.name)}</span><span class="muted">${e.approx ? "≈ " : ""}${dShort(e.start)} · ${n === 1 ? "tomorrow" : `in ${n} days`}</span></li>`;
  }).join("");
  $("#season").innerHTML = `${live}<div class="ev-next"><h2 class="section-h">Coming up</h2><ul>${next}</ul></div>`;
}

// ---------- Buy verdict ----------
function verdict(a, cap) {
  if (!a) return null;
  const downNow = sea.active.find((e) => e.effect === "down");
  const upNow = sea.active.find((e) => e.effect === "up");
  const nextDown = sea.next.find((e) => e.effect === "down");
  const inDays = nextDown ? daysUntil(nextDown.start) : Infinity;
  if (cap && a.price <= cap) return { tone: "buy", label: "Buy", text: `Under your ${eur(cap)} cap at ${a.shop}.` };
  if (a.isDeal) return { tone: "buy", label: "Good deal", text: `${pctTxt(a.pct)} vs. its usual ${eur(a.usual)}${a.isLow ? ", and the lowest tracked so far" : ""}.` };
  if (a.isLow) return { tone: "buy", label: "Low", text: "At the lowest price tracked so far." };
  if (a.usual === null) {
    return downNow
      ? { tone: "watch", label: "Watch", text: `${downNow.name} is on, so prices may be at their yearly low. Not enough history yet to confirm (${a.days}/7 days).` }
      : { tone: "neutral", label: "Learning", text: `Building history (${a.days}/7 days) before judging what "usual" is.` };
  }
  if (downNow) return { tone: "watch", label: "Meh", text: `${downNow.name} is on, but this price is ${a.pct <= 0 ? "only" : ""} ${pctTxt(a.pct)} vs. usual: not a real deal.` };
  if (inDays <= 21) return { tone: "wait", label: "Wait", text: `${nextDown.name} starts in ${inDays} days. Prices usually drop.` };
  if (upNow) return { tone: "wait", label: "Wait", text: `${upNow.name}: prices tend to climb. Next drop: ${nextDown.name} (${dShort(nextDown.start)}).` };
  return { tone: "neutral", label: "Normal", text: "Normal price. Your alerts will fire when it drops." };
}

// ---------- Data helpers ----------
const productPoints = (id) => history?.products?.[id]?.points ?? [];
const endT = latest ? Date.parse(latest.checkedAt) : now;
const bestSeries = (points) => {
  const xs = points.flatMap((p) => { const b = bestOf(p.s); return b ? [{ x: Date.parse(p.t), y: b.price }] : []; });
  if (xs.length) xs.push({ x: endT, y: xs.at(-1).y });
  return xs;
};

function sparkline(points) {
  const s = bestSeries(points).filter((p) => p.x >= now - 60 * DAY);
  if (s.length < 2) return "";
  const W = 120, H = 32;
  const x0 = s[0].x, x1 = s.at(-1).x || x0 + 1, ys = s.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
  const X = (x) => ((x - x0) / Math.max(1, x1 - x0)) * W, Y = (y) => (hi === lo ? H / 2 : H - 2 - ((y - lo) / (hi - lo)) * (H - 4));
  let d = `M${X(s[0].x).toFixed(1)},${Y(s[0].y).toFixed(1)}`;
  for (let i = 1; i < s.length; i++) d += `H${X(s[i].x).toFixed(1)}V${Y(s[i].y).toFixed(1)}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}

// ---------- Cards ----------
const analyses = new Map();
function renderCards() {
  $("#cards").innerHTML = latest.products.map((p) => {
    const a = analyze(productPoints(p.id), now, latest.dealThresholdPct);
    analyses.set(p.id, a);
    const v = verdict(a, p.alertBelow);
    if (!a) return `<li><button class="card" data-id="${esc(p.id)}"><span class="card-name">${esc(p.name)}</span>
      <span class="card-err">${esc(p.error ?? "No data yet")}</span></button></li>`;
    const badge = a.pct === null ? `<span class="badge">learning ${a.days}/7d</span>`
      : `<span class="badge ${a.pct <= -latest.dealThresholdPct ? "good" : a.pct > 3 ? "bad" : ""}">${pctTxt(a.pct)} vs usual</span>`;
    const cap = p.alertBelow
      ? a.price <= p.alertBelow ? `<span class="good-t">✓ under your ${eur(p.alertBelow)} cap</span>`
        : `Cap ${eur(p.alertBelow)} · <strong>${eur(a.price - p.alertBelow)}</strong> to go`
      : `<span class="muted">No cap set</span>`;
    return `<li><button class="card tone-${v.tone}" data-id="${esc(p.id)}" aria-pressed="false">
      <span class="card-head"><span class="card-name">${esc(p.name)}</span><span class="pill pill-${v.tone}">${v.label}</span></span>
      <span class="card-price">${eur(a.price)}</span>
      <span class="card-shop">${esc(a.shop)}</span>
      <span class="card-row">${badge}${sparkline(productPoints(p.id))}</span>
      <span class="card-cap">${cap}</span>
      ${p.error ? `<span class="card-err">Last check failed: ${esc(p.error)}</span>` : ""}
    </button></li>`;
  }).join("");
  $("#cards").onclick = (e) => {
    const b = e.target.closest(".card");
    if (b) { location.hash = b.dataset.id; }
  };
}

// ---------- Detail ----------
let chart, range = 90;
const BEST = "Best price", shown = new Map(); // product id → names of the lines shown
const RANGES = [[30, "30 d"], [90, "90 d"], [365, "1 y"], [0, "All"]];

function renderDetail(id) {
  const p = latest.products.find((x) => x.id === id) ?? latest.products[0];
  if (!p) return;
  document.querySelectorAll(".card").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.id === p.id)));
  const a = analyses.get(p.id), v = verdict(a, p.alertBelow);
  const el = $("#detail");
  el.hidden = false;
  el.innerHTML = `
    <div class="detail-head">
      <h2>${esc(p.name)}</h2>
      <a href="${esc(p.url)}" target="_blank" rel="noopener" class="muted">idealo page ↗</a>
    </div>
    ${v ? `<div class="verdict tone-${v.tone}"><span class="pill pill-${v.tone}">${v.label}</span><p>${esc(v.text)}</p></div>` : ""}
    ${a ? `<dl class="stats">
      <div><dt>Best now</dt><dd>${eur(a.price)}</dd><dd class="muted">${esc(a.shop)}</dd></div>
      <div><dt>Usual (30 d)</dt><dd>${a.usual ? eur(a.usual) : "—"}</dd><dd class="muted">${a.usual ? pctTxt(a.pct) + " now" : `needs ${7 - a.days} more days`}</dd></div>
      <div><dt>Lowest tracked</dt><dd>${eur(a.low.price)}</dd><dd class="muted">${dShort(new Date(a.low.t))} · ${esc(a.low.shop)}</dd></div>
      <div><dt>Your cap</dt><dd>${p.alertBelow ? eur(p.alertBelow) : "—"}</dd><dd class="muted">${p.alertBelow ? "alert when at or below" : "set it in config.json"}</dd></div>
    </dl>` : ""}
    ${a?.shopDeals?.length ? `<ul class="shop-deals">${a.shopDeals.map((d) =>
      `<li><strong>${esc(d.shop)}</strong> is ${Math.abs(d.pct).toFixed(0)}% below its own usual ${eur(d.usual)}</li>`).join("")}</ul>` : ""}
    <div class="chart-head">
      <h3>Price history</h3>
      <div class="seg" role="group" aria-label="Time range">${RANGES.map(([d, l]) =>
        `<button data-range="${d}" aria-pressed="${d === range}">${l}</button>`).join("")}</div>
    </div>
    <div class="chart-box"><canvas id="chart" role="img" aria-label="Price history chart for ${esc(p.name)}"></canvas></div>
    <div id="shops" class="chips" role="group" aria-label="Lines shown on the chart"></div>
    <p class="muted legend-note">Shaded: sales periods (green = prices usually drop, red = usually climb). Right of the "today" line: what's coming.</p>
    <h3>Current offers</h3>
    ${p.offers?.length ? `<div class="table-wrap"><table class="offers">
      <thead><tr><th>Shop</th><th>Offer</th><th class="num">Price</th><th><span class="sr">Link</span></th></tr></thead>
      <tbody>${p.offers.map((o) => `<tr>
        <td>${esc(o.shop)}</td><td class="offer-title">${esc(o.title)}</td><td class="num">${eurC(o.price)}</td>
        <td>${o.url ? `<a class="btn" href="${esc(o.url)}" target="_blank" rel="noopener nofollow">Open</a>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="card-err">${esc(p.error ?? "No offers")}</p>`}
  `;
  el.querySelector(".seg").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    range = +b.dataset.range;
    el.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    drawChart(p);
  };
  drawChart(p);
}

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function drawChart(p) {
  if (!window.Chart) return;
  chart?.destroy();
  const points = productPoints(p.id);
  const best = bestSeries(points);
  if (!best.length) return;
  const palette = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--s${i}`));
  const first = best[0].x;
  const xMin = range ? Math.min(first, now - range * DAY) : first - DAY;
  const xMax = now + Math.max(14, (range || 90) / 6) * DAY;

  // Shops selling it now, cheapest first, then shops that only appear in older snapshots.
  const nowS = points.at(-1).s;
  const shops = [...new Set([...Object.keys(nowS).sort((a, b) => nowS[a] - nowS[b]), ...points.flatMap((pt) => Object.keys(pt.s))])];
  const vis = shown.get(p.id) ?? new Set([BEST, ...shops.slice(0, 5)]);
  shown.set(p.id, vis);
  const color = (i) => palette[i % palette.length];
  const shopSets = shops.flatMap((shop, i) => {
    if (!vis.has(shop)) return [];
    const data = points.map((pt) => ({ x: Date.parse(pt.t), y: pt.s[shop] ?? null }));
    data.push({ x: endT, y: data.at(-1).y });
    return [{ label: shop, data, borderColor: color(i), backgroundColor: color(i), borderWidth: 1.5, stepped: true, pointRadius: 0, spanGaps: false }];
  });
  const datasets = [
    ...(vis.has(BEST) ? [{ label: BEST, data: best, borderColor: css("--ink"), backgroundColor: css("--ink"), borderWidth: 3, stepped: true, pointRadius: 0 }] : []),
    ...shopSets,
  ];

  // Chips double as the legend: tap a shop to show/hide its line.
  const chip = (name, dot, price) => `<button class="chip" data-name="${esc(name)}" aria-pressed="${vis.has(name)}">
    <span class="dot" style="background:${dot}"></span>${esc(name)}${price ? ` <span class="muted">${eur(price)}</span>` : ""}</button>`;
  const box = $("#shops");
  box.innerHTML = [
    ...[["top", "Top 5"], ["all", "All shops"], ["best", "Best only"]].map(([k, l]) => `<button class="chip chip-preset" data-preset="${k}">${l}</button>`),
    chip(BEST, css("--ink"), best.at(-1).y),
    ...shops.map((s, i) => chip(s, color(i), nowS[s])),
  ].join("");
  box.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const k = b.dataset.preset;
    if (k) shown.set(p.id, new Set([BEST, ...(k === "all" ? shops : k === "top" ? shops.slice(0, 5) : [])]));
    else vis.has(b.dataset.name) ? vis.delete(b.dataset.name) : vis.add(b.dataset.name);
    drawChart(p);
  };
  if (p.alertBelow) datasets.push({ label: "Your cap", data: [{ x: xMin, y: p.alertBelow }, { x: xMax, y: p.alertBelow }],
    borderColor: css("--accent"), borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0 });

  const bands = {
    id: "bands",
    beforeDatasetsDraw(c) {
      const { ctx, chartArea: ar, scales: { x } } = c;
      ctx.save();
      ctx.font = `500 11px ${css("--font")}`;
      let labelEnd = -Infinity; // skip labels that would overlap the previous one
      for (const e of sea.all) {
        const s = Math.max(+e.start, x.min), en = Math.min(+e.end + DAY, x.max);
        if (en <= s) continue;
        const l = x.getPixelForValue(s), r = x.getPixelForValue(en);
        ctx.fillStyle = css(e.effect === "down" ? "--band-down" : "--band-up");
        ctx.fillRect(l, ar.top, r - l, ar.bottom - ar.top);
        const w = Math.min(ctx.measureText(e.name).width, Math.max(r - l - 8, 60));
        if (l + 4 > labelEnd && r - l > 6) {
          ctx.fillStyle = css("--muted");
          ctx.fillText(e.name, l + 4, ar.top + 12, w);
          labelEnd = l + 4 + w + 6;
        }
      }
      const t = x.getPixelForValue(now);
      ctx.strokeStyle = css("--muted"); ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(t, ar.top); ctx.lineTo(t, ar.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = css("--muted"); ctx.fillText("today", t + 4, ar.bottom - 6);
      ctx.restore();
    },
  };

  const grid = css("--line"), tick = css("--muted");
  chart = new Chart($("#chart"), {
    type: "line",
    data: { datasets },
    plugins: [bands],
    options: {
      maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        x: { type: "linear", min: xMin, max: xMax, grid: { color: grid }, ticks: { color: tick, maxTicksLimit: 7, callback: (v) => dShort(new Date(v)) } },
        y: { grid: { color: grid }, ticks: { color: tick, callback: (v) => eur(v) }, grace: "8%" },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (it) => dLong(new Date(it[0].parsed.x)), label: (it) => ` ${it.dataset.label}: ${eurC(it.parsed.y)}` } },
      },
    },
  });
}

// ---------- Boot ----------
renderSeason();
if (!latest) {
  $("#cards").innerHTML = `<li class="card-err">No price data yet. Run <code>npm run track</code> or wait for the first scheduled run.</li>`;
} else {
  const t = Date.parse(latest.checkedAt);
  $("#checked").innerHTML = `Checked ${ago(t)}${now - t > 12 * 36e5 ? ` <span class="bad-t">· tracker may be stalled</span>` : ""}`;
  $("#checked").title = dLong(new Date(t));
  renderCards();
  const show = () => renderDetail(decodeURIComponent(location.hash.slice(1)));
  addEventListener("hashchange", () => { show(); $("#detail").scrollIntoView({ behavior: "smooth", block: "start" }); });
  show();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", show);
}
