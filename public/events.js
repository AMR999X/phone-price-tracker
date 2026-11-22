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
      tip: "Official winter sales: real markdowns, especially on last year's models." },
    { name: "French Days (spring)", start: d(y, 4, 28), end: d(y, 5, 5), effect: "down", approx: true,
      tip: "Fnac, Darty, Boulanger, Cdiscount run a week of promos." },
    { name: "Soldes d'été", start: ss, end: add(ss, 27), effect: "down",
      tip: "Summer sales: good for older models, less so for recent ones." },
    { name: "Amazon Prime Day", start: d(y, 7, 8), end: d(y, 7, 11), effect: "down", approx: true,
      tip: "Mostly Amazon; other shops often match on popular phones." },
    { name: "French Days (autumn)", start: d(y, 9, 22), end: d(y, 9, 29), effect: "down", approx: true,
      tip: "Second French Days of the year." },
    { name: "New Xiaomi T launch", start: d(y, 9, 24), end: d(y, 10, 10), effect: "down", approx: true,
      tip: "A new T model usually launches late September; the previous T models drop in price." },
    { name: "Singles' Day 11.11", start: d(y, 11, 11), end: d(y, 11, 11), effect: "down",
      tip: "Big on AliExpress and Xiaomi's own store." },
    { name: "Black Friday week", start: add(bf, -7), end: add(bf, 3), effect: "down",
      tip: "Lowest prices of the year are common here. Check the price vs. its usual price: some 'deals' are inflated." },
    { name: "Christmas run-up", start: add(bf, 4), end: d(y, 12, 24), effect: "up",
      tip: "Prices tend to creep back up and stock gets tight. If you saw a Black Friday-level price, take it." },
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
