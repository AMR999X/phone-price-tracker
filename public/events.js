// French retail calendar, computed per year so it never goes stale.
const d = (y, m, day) => new Date(y, m - 1, day);
const add = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
// weekday: 0=Sun … 6=Sat
const nthWeekday = (y, m, wd, n) => d(y, m, 1 + ((wd - d(y, m, 1).getDay() + 7) % 7) + (n - 1) * 7);
const lastWeekday = (y, m, wd) => {
  const last = d(y, m + 1, 0);
  return d(y, m, last.getDate() - ((last.getDay() - wd + 7) % 7));
};

// Code de commerce L310-3: winter sales start the 2nd Wednesday of January (the 1st if the 2nd is after the 12th);
// summer sales the last Wednesday of June (the one before if it's after the 28th). Both last 4 weeks.
export const winterSales = (y) => {
  const w = nthWeekday(y, 1, 3, 2);
  return w.getDate() > 12 ? nthWeekday(y, 1, 3, 1) : w;
};
export const summerSales = (y) => {
  const w = lastWeekday(y, 6, 3);
  return w.getDate() > 28 ? add(w, -7) : w;
};
export const blackFriday = (y) => nthWeekday(y, 11, 5, 4);

// effect: "down" = prices usually drop, "up" = usually climb. approx: retailer-chosen dates, roughly the same each year.
export function eventsFor(y) {
  const bf = blackFriday(y), ws = winterSales(y), ss = summerSales(y);
  return [
    { name: "Soldes d'hiver", start: ws, end: add(ws, 27), effect: "down",
      tip: "Soldes officielles : vraies démarques, surtout sur les modèles de l'an dernier." },
    { name: "French Days (printemps)", start: d(y, 4, 28), end: d(y, 5, 5), effect: "down", approx: true,
      tip: "Fnac, Darty, Boulanger et Cdiscount font une semaine de promos." },
    { name: "Soldes d'été", start: ss, end: add(ss, 27), effect: "down",
      tip: "Bon plan pour les anciens modèles, moins pour les récents." },
    { name: "Amazon Prime Day", start: d(y, 7, 8), end: d(y, 7, 11), effect: "down", approx: true,
      tip: "Surtout Amazon ; les autres enseignes s'alignent souvent sur les téléphones populaires." },
    { name: "French Days (automne)", start: d(y, 9, 22), end: d(y, 9, 29), effect: "down", approx: true,
      tip: "Deuxièmes French Days de l'année." },
    { name: "Sortie des nouveaux Xiaomi T", start: d(y, 9, 24), end: d(y, 10, 10), effect: "down", approx: true,
      tip: "Un nouveau T sort souvent fin septembre ; les anciens T baissent." },
    { name: "Singles' Day 11.11", start: d(y, 11, 11), end: d(y, 11, 11), effect: "down",
      tip: "Surtout sur AliExpress et la boutique Xiaomi." },
    { name: "Semaine du Black Friday", start: add(bf, -7), end: add(bf, 3), effect: "down",
      tip: "Souvent les prix les plus bas de l'année. Compare au prix habituel : certaines « promos » sont gonflées." },
    { name: "Avant Noël", start: add(bf, 4), end: d(y, 12, 24), effect: "up",
      tip: "Les prix remontent et les stocks baissent. Si tu vois un prix de Black Friday, prends-le." },
  ];
}

const endOf = (e) => add(e.end, 1);

export function season(now = new Date()) {
  const y = now.getFullYear();
  const all = [...eventsFor(y - 1), ...eventsFor(y), ...eventsFor(y + 1)];
  return {
    all,
    active: all.filter((e) => e.start <= now && now < endOf(e)),
    next: all.filter((e) => e.start > now).sort((a, b) => a.start - b.start).slice(0, 4),
  };
}

export const daysUntil = (date, now = new Date()) => Math.ceil((date - now) / 864e5);
