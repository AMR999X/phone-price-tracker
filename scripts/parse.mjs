// idealo.fr offer-list parser.
const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", shy: "", reg: "®", trade: "™", eacute: "é", Eacute: "É",
  egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", icirc: "î", ocirc: "ô", ucirc: "û", ugrave: "ù", euml: "ë", iuml: "ï" };
export const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m)
  .replace(/\s+/g, " ").trim();

// shortcut: regex parsing of idealo's offer list markup; if idealo changes its HTML, update these 4 patterns.
export function parseOffers(html) {
  return html.split(/<li[^>]+class="productOffers-listItem[ "]/).slice(1).flatMap((b) => {
    const price = Number(b.match(/[?&;]price=([\d.]+)/)?.[1]);
    const shop = b.match(/<noscript>[\s\S]*?alt="([^"]+)"/)?.[1];
    const title = b.match(/productOffers-listItemTitleInner[^>]*>([\s\S]*?)</)?.[1];
    const href = b.match(/href="(\/relocator\/relocate\?[^"]+)"/)?.[1];
    if (!price || !shop) return [];
    return [{ shop: decode(shop), price, title: decode(title ?? ""), url: href && "https://www.idealo.fr" + decode(href) }];
  });
}
