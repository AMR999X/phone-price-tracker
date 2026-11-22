import { analyze, bestOf } from "./insights.js";
import { season, daysUntil } from "./events.js";

const $ = (s) => document.querySelector(s);
const DAY = 864e5;
const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format;
const eurC = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format;
const dShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format;
const dLong = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pctTxt = (p) => `${p > 0 ? "+" : "−"}${Math.abs(p).toFixed(0)} %`;
const ago = (t) => {
  const h = (Date.now() - t) / 36e5;
  return h < 1 ? `il y a ${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `il y a ${Math.round(h)} h` : `il y a ${Math.round(h / 24)} jours`;
};

const load = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const [latest, history] = await Promise.all([load("data/latest.json"), load("data/history.json")]);
const now = Date.now();
const sea = season(new Date());
const products = latest?.products ?? [];
const dealPct = latest?.dealThresholdPct ?? 7;
const pointsOf = (id) => history?.products?.[id]?.points ?? [];
const analyses = new Map(products.map((p) => [p.id, analyze(pointsOf(p.id), now, dealPct)]));
const productById = (id) => products.find((p) => p.id === id) ?? products[0];
const endT = latest ? Date.parse(latest.checkedAt) : now;

// ---------- Verdict ----------
function verdict(a, cap) {
  if (!a) return null;
  const downNow = sea.active.find((e) => e.effect === "down");
  const upNow = sea.active.find((e) => e.effect === "up");
  const nextDown = sea.next.find((e) => e.effect === "down");
  const inDays = nextDown ? daysUntil(nextDown.start) : Infinity;
  if (cap && a.price <= cap) return { tone: "buy", label: "Acheter", text: `Sous ton plafond de ${eur(cap)} chez ${a.shop}.` };
  if (a.isDeal) return { tone: "buy", label: "Bonne affaire", text: `${pctTxt(a.pct)} par rapport à son prix habituel de ${eur(a.usual)}${a.isLow ? ", et c'est le plus bas relevé" : ""}.` };
  if (a.isLow) return { tone: "buy", label: "Prix bas", text: "Au prix le plus bas relevé jusqu'ici." };
  if (a.usual === null) {
    return downNow
      ? { tone: "watch", label: "À surveiller", text: `${downNow.name} en cours : les prix sont peut-être au plus bas. Pas encore assez d'historique pour le confirmer (${a.days}/7 jours).` }
      : { tone: "neutral", label: "En apprentissage", text: `Historique en cours (${a.days}/7 jours) avant de connaître le prix habituel.` };
  }
  if (downNow) return { tone: "watch", label: "Bof", text: `${downNow.name} en cours, mais ce prix n'est qu'à ${pctTxt(a.pct)} du prix habituel : pas une vraie affaire.` };
  if (inDays <= 21) return { tone: "wait", label: "Attendre", text: `${nextDown.name} dans ${inDays} jours. Les prix baissent souvent.` };
  if (upNow) return { tone: "wait", label: "Attendre", text: `${upNow.name} : les prix ont tendance à monter. Prochaine baisse : ${nextDown.name} (${dShort(nextDown.start)}).` };
  return { tone: "neutral", label: "Prix normal", text: "Prix habituel. Tu seras alerté s'il baisse." };
}

// ---------- Offer specs, pulled from the shop's title ----------
const COLORS = ["noir", "bleu", "violet", "gris", "blanc", "vert", "rose", "argent", "or", "jaune", "rouge", "titane", "black", "blue", "grey", "gray", "white", "green", "silver"];
function specs(title) {
  const out = [];
  const combo = title.match(/\b(\d{1,2})\s?(?:Go|GB)?\s?\+\s?(\d{3,4})\s?(?:Go|GB)/i);
  const ram = combo?.[1] ?? title.match(/\b(\d{1,2})\s?(?:Go|GB)\s?(?:de\s)?RAM/i)?.[1];
  const storage = combo?.[2] ?? title.match(/\b(64|128|256|512)\s?(?:Go|GB)/i)?.[1] ?? (title.match(/\b1\s?(?:To|TB)/i) && "1024");
  if (ram) out.push(`${ram} Go RAM`);
  if (storage) out.push(storage === "1024" ? "1 To" : `${storage} Go`);
  const color = COLORS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(title));
  if (color) out.push(color[0].toUpperCase() + color.slice(1));
  return out;
}
// Shop keys may carry "(Marketplace)" and/or "(Reconditionné)".
const sellerOf = (shop) => ({
  name: shop.replace(/\s*\((Marketplace|Reconditionné)\)/gi, ""),
  note: /\(Marketplace\)/i.test(shop) ? "Vendeur partenaire" : "Vendu par l'enseigne",
  refurb: /\(Reconditionné\)/i.test(shop),
});
const shopLabel = (shop) => { const s = sellerOf(shop); return s.name + (s.note === "Vendeur partenaire" ? " · partenaire" : "") + (s.refurb ? " · reconditionné" : ""); };

// idealo's 1-year daily best price, all sellers: [["YYYY-MM-DD", price], …]
const idealoOf = (id) => (history?.products?.[id]?.idealo?.points ?? []).map(([d, y]) => ({ x: Date.parse(d + "T12:00:00"), y }));
function yearStats(id) {
  const pts = idealoOf(id);
  if (!pts.length) return null;
  const low = pts.reduce((m, p) => (p.y < m.y ? p : m));
  const last90 = pts.filter((p) => p.x >= now - 90 * DAY).map((p) => p.y).sort((a, b) => a - b);
  return { low, med: last90.length ? last90[last90.length >> 1] : null };
}

// ---------- Theme ----------
const root = document.documentElement;
const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
const SUN = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;
function paintThemeButton() {
  const b = $("#theme");
  b.innerHTML = isDark() ? SUN : MOON;
  b.setAttribute("aria-label", isDark() ? "Passer en mode clair" : "Passer en mode sombre");
}
$("#theme").onclick = () => {
  root.dataset.theme = isDark() ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch {}
  paintThemeButton();
  render();
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!root.dataset.theme) { paintThemeButton(); render(); } });
paintThemeButton();

// ---------- Routing: #tab/model/shop ----------
const TABS = ["modeles", "courbe", "offres", "soldes"];
const state = { tab: "modeles", id: null, shop: "" };
try { state.id = localStorage.getItem("model"); } catch {}
function readHash() {
  const [a = "", b = "", c = ""] = location.hash.slice(1).split("/").map(decodeURIComponent);
  if (TABS.includes(a)) Object.assign(state, { tab: a, id: b || state.id, shop: c });
  else if (a) Object.assign(state, { tab: "courbe", id: a, shop: "" }); // notifications open "#<model id>"
  state.id = productById(state.id)?.id ?? null;
  try { if (state.id) localStorage.setItem("model", state.id); } catch {}
}
const href = (tab, id = state.id, shop = "") => "#" + [tab, id, shop].filter(Boolean).map(encodeURIComponent).join("/");

// ---------- Shared pieces ----------
function modelSwitch(tab) {
  return `<div class="switch" role="group" aria-label="Choisir le modèle">${products.map((p) =>
    `<a href="${href(tab, p.id)}" aria-current="${p.id === state.id ? "true" : "false"}">${esc(p.name)}</a>`).join("")}</div>`;
}
const priceTag = (price, big) => `<span class="tag${big ? " tag-big" : ""}">${eur(price)}</span>`;

function sparkline(points, id) {
  const own = bestSeries(points); // fall back to idealo's history while ours is short
  const s = (own.length >= 4 ? own : idealoOf(id)).filter((p) => p.x >= now - 60 * DAY);
  if (s.length < 2) return "";
  const W = 96, H = 28;
  const x0 = s[0].x, x1 = s.at(-1).x || x0 + 1, ys = s.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
  const X = (x) => ((x - x0) / Math.max(1, x1 - x0)) * W, Y = (y) => (hi === lo ? H / 2 : H - 2 - ((y - lo) / (hi - lo)) * (H - 4));
  let d = `M${X(s[0].x).toFixed(1)},${Y(s[0].y).toFixed(1)}`;
  for (let i = 1; i < s.length; i++) d += `H${X(s[i].x).toFixed(1)}V${Y(s[i].y).toFixed(1)}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}
function bestSeries(points) {
  const xs = points.flatMap((p) => { const b = bestOf(p.s); return b ? [{ x: Date.parse(p.t), y: b.price }] : []; });
  if (xs.length) xs.push({ x: endT, y: xs.at(-1).y });
  return xs;
}

// ---------- Tab: Modèles ----------
function viewModels() {
  return `<h2 class="h">Modèles suivis</h2>
  <p class="lede">Meilleur prix neuf dans les enseignes fiables. Touche un modèle pour voir sa courbe.</p>
  <ul class="models">${products.map((p) => {
    const a = analyses.get(p.id), v = verdict(a, p.alertBelow);
    if (!a) return `<li><a class="model" href="${href("courbe", p.id)}"><span class="m-name">${esc(p.name)}</span>
      <span class="err">${esc(p.error ?? "Pas encore de prix")}</span></a></li>`;
    const vsUsual = a.pct === null ? `<span class="badge">historique ${a.days}/7 j</span>`
      : `<span class="badge ${a.pct <= -dealPct ? "good" : a.pct > 3 ? "bad" : ""}">${pctTxt(a.pct)} vs habituel</span>`;
    const cap = p.alertBelow
      ? a.price <= p.alertBelow ? `<span class="good-t">Sous ton plafond de ${eur(p.alertBelow)}</span>`
        : `Plafond ${eur(p.alertBelow)} · encore <strong>${eur(a.price - p.alertBelow)}</strong>`
      : `<span class="muted">Pas de plafond</span>`;
    return `<li><a class="model tone-${v.tone}" href="${href("courbe", p.id)}">
      <span class="m-top"><span class="m-name">${esc(p.name)}</span><span class="pill pill-${v.tone}">${v.label}</span></span>
      <span class="m-mid">${priceTag(a.price)}<span class="m-shop">chez ${esc(sellerOf(a.shop).name)}</span>${sparkline(pointsOf(p.id), p.id)}</span>
      <span class="m-foot">${vsUsual}<span class="m-cap">${cap}</span></span>
      ${p.error ? `<span class="err">${esc(p.error)}${p.okAt ? ` · prix du ${dLong(new Date(p.okAt))}` : ""}</span>` : ""}
    </a></li>`;
  }).join("")}</ul>`;
}

// ---------- Tab: Courbe ----------
let chart, range = 90;
const RANGES = [[30, "30 j"], [90, "90 j"], [365, "1 an"], [0, "Tout"]];
const BEST = "Meilleur prix", IDEALO = "Tous vendeurs (idealo)", shown = new Map(); // model id → names of the lines shown

function viewCurve() {
  const p = productById(state.id), a = analyses.get(p.id), v = verdict(a, p.alertBelow), ys = yearStats(p.id);
  return `${modelSwitch("courbe")}
  ${v ? `<div class="verdict tone-${v.tone}"><span class="pill pill-${v.tone}">${v.label}</span><p>${esc(v.text)}</p></div>` : ""}
  ${a ? `<dl class="stats">
    <div><dt>Meilleur prix</dt><dd>${priceTag(a.price)}</dd><dd class="muted">${esc(sellerOf(a.shop).name)}</dd></div>
    <div><dt>Prix habituel</dt><dd class="num">${a.usual ? eur(a.usual) : "—"}</dd><dd class="muted">${a.usual ? `médiane 30 j · ${pctTxt(a.pct)}` : `encore ${7 - a.days} j d'historique`}</dd></div>
    <div><dt>Plus bas relevé</dt><dd class="num">${eur(a.low.price)}</dd><dd class="muted">${dShort(new Date(a.low.t))} · ${esc(sellerOf(a.low.shop).name)}</dd></div>
    <div><dt>Ton plafond</dt><dd class="num">${p.alertBelow ? eur(p.alertBelow) : "—"}</dd><dd class="muted">${p.alertBelow ? "alerte à ce prix ou moins" : "à régler dans config.json"}</dd></div>
    ${ys ? `<div><dt>Plus bas sur 1 an</dt><dd class="num">${eur(ys.low.y)}</dd><dd class="muted">${dShort(new Date(ys.low.x))} · tous vendeurs</dd></div>
    <div><dt>Médiane 90 jours</dt><dd class="num">${ys.med ? eur(ys.med) : "—"}</dd><dd class="muted">tous vendeurs, imports compris</dd></div>` : ""}
  </dl>` : ""}
  <section class="panel">
    <div class="panel-head">
      <h2 class="h3">Évolution du prix</h2>
      <div class="seg" role="group" aria-label="Période">${RANGES.map(([d, l]) =>
        `<button type="button" data-range="${d}" aria-pressed="${d === range}">${l}</button>`).join("")}</div>
    </div>
    <div class="chart-box"><canvas id="chart" role="img" aria-label="Courbe de prix du ${esc(p.name)}"></canvas></div>
    <div id="shops" class="chips" role="group" aria-label="Lignes affichées"></div>
    <p class="note">Touche la courbe pour lire le prix exact. Pointillés gris : meilleur prix tous vendeurs selon idealo (imports et AliExpress compris), donc souvent plus bas que dans les enseignes fiables. Zones vertes : périodes où les prix baissent d'habitude ; rouges : où ils montent.</p>
  </section>`;
}

const css = (n) => getComputedStyle(root).getPropertyValue(n).trim();

function drawChart(p) {
  chart?.destroy();
  chart = null;
  const box = $("#shops");
  if (!window.Chart) { box.innerHTML = `<p class="err">Le graphique a besoin d'internet pour se charger.</p>`; return; }
  const points = pointsOf(p.id);
  const best = bestSeries(points), ide = idealoOf(p.id);
  if (!best.length && !ide.length) { box.innerHTML = `<p class="muted">Pas encore de prix pour ce modèle.</p>`; return; }
  const palette = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--s${i}`));
  const first = Math.min(best[0]?.x ?? now, ide[0]?.x ?? now);
  const xMin = range ? now - range * DAY : first - DAY;
  const xMax = now + Math.max(10, (range || 90) / 6) * DAY;
  // Few snapshots yet: draw the dots so there is something to touch.
  const dot = points.length < 6 ? 4 : 0;

  // Shops selling it now, cheapest first, then shops that only appear in older snapshots.
  const nowS = points.at(-1)?.s ?? {};
  const shops = [...new Set([...Object.keys(nowS).sort((a, b) => nowS[a] - nowS[b]), ...points.flatMap((pt) => Object.keys(pt.s))])];
  const vis = shown.get(p.id) ?? new Set([BEST, IDEALO, ...shops.slice(0, 3)]);
  shown.set(p.id, vis);
  const color = (i) => palette[i % palette.length];
  const line = (label, data, c, width) => ({ label, data, borderColor: c, backgroundColor: c, borderWidth: width, stepped: true,
    pointRadius: dot, pointHoverRadius: 6, pointHitRadius: 18, spanGaps: false });
  const datasets = [
    ...(vis.has(IDEALO) && ide.length ? [{ ...line(IDEALO, ide, css("--muted"), 1.5), borderDash: [4, 3], pointRadius: 0 }] : []),
    ...(vis.has(BEST) && best.length ? [line(BEST, best, css("--ink"), 3)] : []),
    ...shops.flatMap((shop, i) => {
      if (!vis.has(shop)) return [];
      const data = points.map((pt) => ({ x: Date.parse(pt.t), y: pt.s[shop] ?? null }));
      data.push({ x: endT, y: data.at(-1).y });
      return [line(shopLabel(shop), data, color(i), 1.6)];
    }),
  ];
  if (p.alertBelow) datasets.push({ label: "Ton plafond", data: [{ x: xMin, y: p.alertBelow }, { x: xMax, y: p.alertBelow }],
    borderColor: css("--red"), borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, pointHitRadius: 0 });

  // Chips double as the legend: tap a shop to show/hide its line.
  const chip = (name, dotColor, price, label = name) => `<button type="button" class="chip" data-name="${esc(name)}" aria-pressed="${vis.has(name)}">
    <span class="dot" style="background:${dotColor}"></span>${esc(label)}${price ? ` <span class="muted">${eur(price)}</span>` : ""}</button>`;
  box.innerHTML = [
    ...[["top", "Top 3"], ["all", "Tous"], ["best", "Meilleur seul"]].map(([k, l]) => `<button type="button" class="chip chip-preset" data-preset="${k}">${l}</button>`),
    ...(best.length ? [chip(BEST, css("--ink"), best.at(-1).y)] : []),
    ...(ide.length ? [chip(IDEALO, css("--muted"), ide.at(-1).y)] : []),
    ...shops.map((s, i) => chip(s, color(i), nowS[s], shopLabel(s))),
  ].join("");
  box.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const k = b.dataset.preset;
    if (k) shown.set(p.id, new Set([BEST, ...(k === "best" ? [] : [IDEALO]), ...(k === "all" ? shops : k === "top" ? shops.slice(0, 3) : [])]));
    else vis.has(b.dataset.name) ? vis.delete(b.dataset.name) : vis.add(b.dataset.name);
    drawChart(p);
  };

  const bands = {
    id: "bands",
    beforeDatasetsDraw(c) {
      const { ctx, chartArea: ar, scales: { x } } = c;
      ctx.save();
      ctx.font = `600 11px ${css("--body")}`;
      let labelEnd = -Infinity;
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
      ctx.setLineDash([]); ctx.fillStyle = css("--muted"); ctx.fillText("aujourd'hui", t + 4, ar.bottom - 6);
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
        x: { type: "linear", min: xMin, max: xMax, grid: { color: grid }, ticks: { color: tick, maxTicksLimit: 6, callback: (v) => dShort(new Date(v)) } },
        y: { grid: { color: grid }, ticks: { color: tick, callback: (v) => eur(v) }, grace: "10%" },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "x", intersect: false, filter: (it) => it.parsed.y !== null && it.dataset.label !== "Ton plafond",
          itemSort: (a, b) => a.parsed.y - b.parsed.y,
          backgroundColor: css("--ink"), titleColor: css("--bg"), bodyColor: css("--bg"), padding: 10, boxPadding: 4,
          titleFont: { family: css("--body"), weight: "700" }, bodyFont: { family: css("--body") },
          callbacks: { title: (it) => dLong(new Date(it[0].parsed.x)), label: (it) => ` ${it.dataset.label} : ${eurC(it.parsed.y)}` },
        },
      },
    },
  });
}

// ---------- Tab: Offres ----------
function viewOffers() {
  const p = productById(state.id);
  const seen = new Set(); // same shop + price + specs (e.g. three colours at 399 €) shows once
  const offers = (p.offers ?? []).filter((o) => { const k = `${o.shop}|${o.price}|${specs(o.title).slice(0, 2)}`; return !seen.has(k) && seen.add(k); });
  const byShop = new Map();
  for (const o of offers) if (!byShop.has(o.shop)) byShop.set(o.shop, o.price); // offers are sorted, so first = cheapest
  const shop = byShop.has(state.shop) ? state.shop : "";
  const list = shop ? offers.filter((o) => o.shop === shop) : offers;
  const select = `<label class="field"><span>Magasin</span>
    <select id="shop">
      <option value="">Tous les magasins (${byShop.size})</option>
      ${[...byShop].map(([s, price]) => `<option value="${esc(s)}"${s === shop ? " selected" : ""}>${esc(shopLabel(s))} — ${eur(price)}</option>`).join("")}
    </select></label>`;
  const exact = shop ? `<div class="exact">
      ${priceTag(byShop.get(shop), true)}
      <div><p class="exact-shop">${esc(sellerOf(shop).name)}</p><p class="muted">${sellerOf(shop).note} · relevé ${latest ? ago(endT) : ""}</p></div>
    </div>` : "";
  const rows = list.map((o, i) => {
    const s = sellerOf(o.shop);
    const inner = `
      <span class="o-head"><span class="o-shop">${esc(s.name)}</span>${!shop && i === 0 ? `<span class="pill pill-buy">Le moins cher</span>` : ""}</span>
      <span class="o-seller muted">${s.note}</span>
      <span class="o-specs">${[o.cond === "reconditionné" ? "Reconditionné comme neuf" : "Neuf", ...specs(o.title)].map((x) => `<span>${esc(x)}</span>`).join("")}</span>
      <span class="o-title">${esc(o.title)}</span>
      <span class="o-buy"><span class="o-price">${eurC(o.price)}</span>${o.url ? `<span class="o-go">Voir l'offre<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg></span>` : ""}</span>`;
    return `<li>${o.url ? `<a class="offer" href="${esc(o.url)}" target="_blank" rel="noopener nofollow">${inner}</a>` : `<div class="offer">${inner}</div>`}</li>`;
  }).join("");
  return `${modelSwitch("offres")}
    ${select}
    ${exact}
    ${p.error ? `<p class="err">${esc(p.error)}${p.okAt ? `. Offres du ${dLong(new Date(p.okAt))}.` : ""}</p>` : ""}
    <ul class="offers">${rows || `<li class="muted">Aucune offre pour l'instant.</li>`}</ul>
    <p class="note">Offres neuves et reconditionnées « comme neuf » des enseignes fiables, triées par prix. « Vendeur partenaire » = vendu par un vendeur tiers sur le site de l'enseigne, qui reste garante en cas de litige.</p>`;
}

// ---------- Tab: Soldes ----------
function viewSales() {
  const live = sea.active.map((e) => `<li class="ev ev-live ev-${e.effect}">
      <span class="ev-when">En ce moment · jusqu'au ${dShort(e.end)}${e.approx ? " (environ)" : ""}</span>
      <strong>${esc(e.name)}</strong><p>${esc(e.tip)}</p></li>`).join("");
  const next = sea.next.map((e) => {
    const n = daysUntil(e.start);
    return `<li class="ev ev-${e.effect}">
      <span class="ev-when">${e.approx ? "vers le " : ""}${dShort(e.start)} · ${n === 1 ? "demain" : `dans ${n} jours`}</span>
      <strong>${esc(e.name)}</strong><p>${esc(e.tip)}</p></li>`;
  }).join("");
  const legend = [
    ["buy", "Acheter", "le prix est sous ton plafond."],
    ["buy", "Bonne affaire", `au moins ${dealPct} % sous le prix habituel (médiane des 30 derniers jours).`],
    ["wait", "Attendre", "une période de soldes arrive bientôt, ou les prix montent en ce moment."],
    ["watch", "Bof", "c'est la période des promos, mais ce prix n'a rien d'exceptionnel."],
    ["neutral", "Prix normal", "rien de spécial, l'appli te préviendra s'il baisse."],
  ].map(([t, l, d]) => `<li><span class="pill pill-${t}">${l}</span> ${d}</li>`).join("");
  return `<h2 class="h">Calendrier des soldes</h2>
    <p class="lede">Les moments de l'année où les téléphones baissent (vert) ou remontent (rouge).</p>
    <ul class="events">${live}${next}</ul>
    <h2 class="h3">Comment lire les conseils</h2>
    <ul class="legend">${legend}</ul>
    <p class="note">Prix relevés sur idealo.fr toutes les heures, enseignes fiables uniquement. Les alertes arrivent en notification.</p>`;
}

// ---------- Render ----------
function render() {
  readHash();
  document.querySelectorAll(".tabs a").forEach((a) => {
    a.href = href(a.dataset.tab, a.dataset.tab === "modeles" || a.dataset.tab === "soldes" ? "" : state.id);
    a.setAttribute("aria-current", a.dataset.tab === state.tab ? "page" : "false");
  });
  const view = $("#view");
  chart?.destroy();
  chart = null;
  if (!latest) {
    view.innerHTML = `<p class="err">Pas encore de prix. Ouvre l'appli avec internet pour lancer la première vérification.</p>`;
    return;
  }
  view.innerHTML = { modeles: viewModels, courbe: viewCurve, offres: viewOffers, soldes: viewSales }[state.tab]();
  view.querySelector(".switch [aria-current=true]")?.scrollIntoView({ block: "nearest", inline: "center" });
  if (state.tab === "courbe") {
    const p = productById(state.id);
    view.querySelector(".seg").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      range = +b.dataset.range;
      view.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      drawChart(p);
    };
    drawChart(p);
  }
  if (state.tab === "offres") $("#shop").onchange = (e) => { location.hash = href("offres", state.id, e.target.value); };
}

if (latest) {
  const t = Date.parse(latest.okAt ?? latest.checkedAt);
  $("#checked").innerHTML = `Vérifié ${ago(t)}${now - t > 6 * 36e5 ? ` · <span class="bad-t">vérifications en retard</span>` : ""}`;
  $("#checked").title = dLong(new Date(t));
}
let lastTab = null;
addEventListener("hashchange", () => { render(); if (state.tab !== lastTab) scrollTo(0, 0); lastTab = state.tab; });
render();
lastTab = state.tab;
