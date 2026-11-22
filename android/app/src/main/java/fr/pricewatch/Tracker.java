package fr.pricewatch;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Port of scripts/scrape.mjs + parse.mjs + the alert half of public/insights.js, run on the phone
 * (idealo blocks datacenter IPs, not phones). Writes the same history.json / latest.json the website reads.
 */
final class Tracker {
    static final String CONFIG_URL = "https://raw.githubusercontent.com/AMR999X/phone-price-tracker/main/config.json";
    static final long DAY = 86_400_000L;
    private static final String TAG = "PriceWatch";

    static final class Offer {
        final String shop, title, url;
        final double price;
        Offer(String shop, double price, String title, String url) { this.shop = shop; this.price = price; this.title = title; this.url = url; }
    }

    // ---------- Parser (keep in sync with scripts/parse.mjs) ----------
    private static final Map<String, String> ENTITIES = new LinkedHashMap<>();
    static {
        String[] kv = { "amp", "&", "quot", "\"", "apos", "'", "lt", "<", "gt", ">", "nbsp", " ", "shy", "", "reg", "®", "trade", "™",
            "eacute", "é", "Eacute", "É", "egrave", "è", "ecirc", "ê", "agrave", "à", "acirc", "â", "ccedil", "ç", "icirc", "î",
            "ocirc", "ô", "ucirc", "û", "ugrave", "ù", "euml", "ë", "iuml", "ï" };
        for (int i = 0; i < kv.length; i += 2) ENTITIES.put(kv[i], kv[i + 1]);
    }
    private static final Pattern NUM_ENT = Pattern.compile("&#(\\d+);"), NAMED_ENT = Pattern.compile("&([a-zA-Z]+);");
    private static final Pattern P_PRICE = Pattern.compile("[?&;]price=([\\d.]+)");
    private static final Pattern P_SHOP = Pattern.compile("<noscript>[\\s\\S]*?alt=\"([^\"]+)\"");
    private static final Pattern P_TITLE = Pattern.compile("productOffers-listItemTitleInner[^>]*>([\\s\\S]*?)<");
    private static final Pattern P_HREF = Pattern.compile("href=\"(/relocator/relocate\\?[^\"]+)\"");

    static String decode(String s) {
        StringBuffer out = new StringBuffer(); // StringBuilder overloads of appendReplacement need Android 14
        Matcher m = NUM_ENT.matcher(s);
        while (m.find()) m.appendReplacement(out, Matcher.quoteReplacement(new String(Character.toChars(Integer.parseInt(m.group(1))))));
        m.appendTail(out);
        m = NAMED_ENT.matcher(out.toString());
        out = new StringBuffer();
        while (m.find()) { String v = ENTITIES.get(m.group(1)); m.appendReplacement(out, Matcher.quoteReplacement(v != null ? v : m.group())); }
        m.appendTail(out);
        // Android regex is ICU, which rejects (?U); list the non-ASCII spaces JS \s also matches.
        return out.toString().replaceAll("[\\s\\u00A0\\u2000-\\u200B\\u202F\\u3000]+", " ").trim();
    }

    private static String first(Pattern p, String s) { Matcher m = p.matcher(s); return m.find() ? m.group(1) : null; }

    static List<Offer> parseOffers(String html) {
        List<Offer> out = new ArrayList<>();
        String[] blocks = html.split("<li[^>]+class=\"productOffers-listItem[ \"]");
        for (int i = 1; i < blocks.length; i++) {
            String b = blocks[i], priceS = first(P_PRICE, b), shop = first(P_SHOP, b), title = first(P_TITLE, b), href = first(P_HREF, b);
            double price;
            try { price = Double.parseDouble(priceS); } catch (RuntimeException e) { continue; }
            if (!(price > 0) || shop == null) continue;
            out.add(new Offer(decode(shop), price, decode(title != null ? title : ""), href != null ? "https://www.idealo.fr" + decode(href) : null));
        }
        return out;
    }

    // ---------- Analysis (keep in sync with analyze() in public/insights.js) ----------
    static final class Analysis {
        String shop; double price; Double usual, pct; long days; double low; boolean isDeal, isLow;
    }

    private static Map.Entry<String, Double> bestOf(JSONObject s) throws JSONException {
        Map.Entry<String, Double> best = null;
        for (Iterator<String> it = s.keys(); it.hasNext(); ) {
            String k = it.next(); double v = s.getDouble(k);
            if (best == null || v < best.getValue()) best = new AbstractMap.SimpleEntry<>(k, v);
        }
        return best;
    }

    private static double median(List<Double> xs) {
        List<Double> a = new ArrayList<>(xs); Collections.sort(a);
        int m = a.size() >> 1;
        return a.size() % 2 == 1 ? a.get(m) : (a.get(m - 1) + a.get(m)) / 2;
    }

    static Analysis analyze(JSONArray points, long now, double dealPct) throws JSONException {
        if (points == null || points.length() == 0) return null;
        Map.Entry<String, Double> cur = bestOf(points.getJSONObject(points.length() - 1).getJSONObject("s"));
        if (cur == null) return null;
        long first = Instant.parse(points.getJSONObject(0).getString("t")).toEpochMilli();
        Analysis a = new Analysis();
        a.shop = cur.getKey(); a.price = cur.getValue();
        a.days = Math.floorDiv(now - first, DAY);

        List<Double> daily = new ArrayList<>();
        for (long t = Math.max(first, now - 30 * DAY); t <= now; t += DAY) {
            JSONObject s = null;
            for (int i = 0; i < points.length(); i++) {
                if (Instant.parse(points.getJSONObject(i).getString("t")).toEpochMilli() > t) break;
                s = points.getJSONObject(i).getJSONObject("s");
            }
            if (s != null && s.length() > 0) daily.add(bestOf(s).getValue());
        }
        a.low = Double.MAX_VALUE;
        for (int i = 0; i < points.length(); i++) {
            Map.Entry<String, Double> b = bestOf(points.getJSONObject(i).getJSONObject("s"));
            if (b != null && b.getValue() < a.low) a.low = b.getValue();
        }
        boolean enough = a.days >= 7;
        a.usual = enough ? median(daily) : null;
        a.pct = a.usual != null ? (a.price - a.usual) / a.usual * 100 : null;
        a.isDeal = a.pct != null && a.pct <= -dealPct;
        a.isLow = enough && a.price <= a.low * 1.01;
        return a;
    }

    // ---------- Run (keep in sync with scripts/scrape.mjs) ----------
    private static String fetch(String url) throws IOException {
        IOException last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(30000); c.setReadTimeout(30000);
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36");
                c.setRequestProperty("Accept-Language", "fr-FR,fr;q=0.9");
                c.setRequestProperty("Accept", "text/html,application/xhtml+xml");
                try {
                    if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
                    try (InputStream in = c.getInputStream()) { return readAll(in); }
                } finally { c.disconnect(); }
            } catch (IOException e) {
                last = e;
                if (attempt < 3) try { Thread.sleep(5000L * attempt); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); throw e; }
            }
        }
        throw last;
    }

    static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    /** Reads filesDir/name, else the copy bundled from public/data, else the fallback. */
    private static JSONObject readJson(Context c, String name, String fallback) throws IOException, JSONException {
        File f = new File(c.getFilesDir(), name);
        if (f.exists()) try (InputStream in = new FileInputStream(f)) { return new JSONObject(readAll(in)); }
        try (InputStream in = c.getAssets().open("data/" + name)) { return new JSONObject(readAll(in)); }
        catch (IOException e) { return new JSONObject(fallback); }
    }

    /** Write to a temp file then rename, so a kill mid-write never corrupts the price history. */
    private static void writeJson(Context c, String name, JSONObject v) throws IOException {
        File tmp = new File(c.getFilesDir(), name + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(v.toString().getBytes(StandardCharsets.UTF_8)); }
        if (!tmp.renameTo(new File(c.getFilesDir(), name))) throw new IOException("could not save " + name);
    }

    private static JSONObject loadConfig(Context c) throws IOException, JSONException {
        try {
            JSONObject cfg = new JSONObject(fetch(CONFIG_URL));
            writeJson(c, "config.json", cfg);
            return cfg;
        } catch (IOException | JSONException e) {
            Log.w(TAG, "config from GitHub failed, using cached copy: " + e.getMessage());
            File f = new File(c.getFilesDir(), "config.json");
            if (!f.exists()) throw new IOException("can't download config.json: " + e.getMessage());
            try (InputStream in = new FileInputStream(f)) { return new JSONObject(readAll(in)); }
        }
    }

    static boolean shopOk(String shop, Pattern exShops, Pattern onlyShops) {
        return (exShops == null || !exShops.matcher(shop).find()) && (onlyShops == null || onlyShops.matcher(shop).find());
    }

    /** Drop history of shops now filtered out and of products removed from config.json, so charts and "usual" match. */
    static void pruneHistory(JSONObject hp, JSONArray products, Pattern exShops, Pattern onlyShops) throws JSONException {
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (int i = 0; i < products.length(); i++) ids.add(products.getJSONObject(i).getString("id"));
        for (String id : new ArrayList<>(toList(hp.keys()))) {
            if (!ids.contains(id)) { hp.remove(id); continue; }
            JSONArray pts = hp.getJSONObject(id).getJSONArray("points"), kept = new JSONArray();
            for (int i = 0; i < pts.length(); i++) {
                JSONObject s = pts.getJSONObject(i).getJSONObject("s");
                for (String shop : toList(s.keys())) if (!shopOk(shop, exShops, onlyShops)) s.remove(shop);
                if (s.length() > 0) kept.put(pts.getJSONObject(i));
            }
            hp.getJSONObject(id).put("points", kept);
        }
    }

    private static List<String> toList(Iterator<String> it) { List<String> l = new ArrayList<>(); it.forEachRemaining(l::add); return l; }

    private static String str(JSONObject o, String k) throws JSONException { return o.isNull(k) ? null : o.getString(k); }
    private static Pattern re(String s) { return s == null ? null : Pattern.compile(s, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE); }
    private static String eur(double n) { return Math.round(n) + "€"; }

    static synchronized void run(Context c) {
        try {
            JSONObject cfg = loadConfig(c);
            JSONObject history = readJson(c, "history.json", "{\"products\":{}}");
            JSONObject alertState = readJson(c, "alert-state.json", "{}");
            String now = Instant.now().toString();
            double dealPct = cfg.optDouble("dealThresholdPct", 7);
            Pattern exShops = re(str(cfg, "excludeShops")), exTitles = re(str(cfg, "excludeTitles")), onlyShops = re(str(cfg, "onlyShops"));
            JSONArray latestProducts = new JSONArray();
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel("alerts", "Alertes de prix", NotificationManager.IMPORTANCE_HIGH));

            JSONArray products = cfg.getJSONArray("products");
            pruneHistory(history.getJSONObject("products"), products, exShops, onlyShops);
            for (int i = 0; i < products.length(); i++) {
                JSONObject p = products.getJSONObject(i);
                String id = p.getString("id"), name = p.getString("name");
                Double cap = p.isNull("alertBelow") || !p.has("alertBelow") ? null : p.getDouble("alertBelow");
                JSONObject meta = new JSONObject().put("id", id).put("name", name).put("url", p.getString("url"))
                    .put("alertBelow", cap == null ? JSONObject.NULL : cap);
                try {
                    Pattern include = re(p.has("include") ? str(p, "include") : null);
                    List<Offer> offers = new ArrayList<>();
                    for (Offer o : parseOffers(fetch(p.getString("url")))) {
                        if (!shopOk(o.shop, exShops, onlyShops)) continue;
                        if (exTitles != null && exTitles.matcher(o.title).find()) continue;
                        if (include != null && !include.matcher(o.title).find()) continue;
                        offers.add(o);
                    }
                    offers.sort((x, y) -> Double.compare(x.price, y.price));
                    if (offers.isEmpty()) throw new IOException("no matching offers (page layout changed, or `include` filter too strict)");

                    JSONObject snapshot = new JSONObject();
                    for (Offer o : offers) if (!snapshot.has(o.shop)) snapshot.put(o.shop, o.price); // sorted: first = cheapest per shop
                    JSONObject hp = history.getJSONObject("products").optJSONObject(id);
                    if (hp == null) { hp = new JSONObject().put("points", new JSONArray()); history.getJSONObject("products").put(id, hp); }
                    JSONArray points = hp.getJSONArray("points");
                    if (points.length() == 0 || !sameSnapshot(points.getJSONObject(points.length() - 1).getJSONObject("s"), snapshot))
                        points.put(new JSONObject().put("t", now).put("s", snapshot));

                    JSONArray top = new JSONArray();
                    for (Offer o : offers.subList(0, Math.min(20, offers.size())))
                        top.put(new JSONObject().put("shop", o.shop).put("price", o.price).put("title", o.title).put("url", o.url == null ? JSONObject.NULL : o.url));
                    latestProducts.put(meta.put("offers", top));

                    // Alert once per drop: re-alert only if it falls >1€ below the last alerted price; reset when the condition ends.
                    Analysis a = analyze(points, System.currentTimeMillis(), dealPct);
                    JSONObject st = alertState.optJSONObject(id);
                    if (st == null) { st = new JSONObject(); alertState.put(id, st); }
                    boolean underCap = cap != null && a.price <= cap;
                    boolean capDue = due(st, "cap", underCap, a.price), dealDue = due(st, "deal", a.isDeal, a.price);
                    if (capDue || dealDue) {
                        List<String> reasons = new ArrayList<>();
                        if (underCap) reasons.add("sous ton plafond de " + eur(cap));
                        if (a.isDeal) reasons.add(String.format(Locale.ROOT, "%.0f %% sous son prix habituel de %s", Math.abs(a.pct), eur(a.usual)));
                        if (a.isLow) reasons.add("prix le plus bas relevé");
                        String title = name + " : " + eur(a.price) + " chez " + a.shop;
                        String text = String.join(" · ", reasons) + ".\n" + offers.get(0).title;
                        if (nm.areNotificationsEnabled()) {
                            notify(c, nm, id, title, text, offers.get(0).url);
                            if (capDue) st.put("cap", a.price);
                            if (dealDue) st.put("deal", a.price);
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, name + ": FAILED — " + e.getMessage());
                    latestProducts.put(meta.put("error", e.getMessage()));
                }
            }
            writeJson(c, "history.json", history);
            writeJson(c, "latest.json", new JSONObject().put("checkedAt", now).put("dealThresholdPct", dealPct).put("products", latestProducts));
            writeJson(c, "alert-state.json", alertState);
        } catch (Throwable e) { // never let a bad page or full disk crash the app
            Log.e(TAG, "run failed", e);
        }
    }

    private static boolean due(JSONObject st, String key, boolean cond, double price) {
        if (!cond) { st.remove(key); return false; }
        return !st.has(key) || price < st.optDouble(key) - 1;
    }

    static boolean sameSnapshot(JSONObject a, JSONObject b) {
        if (a.length() != b.length()) return false;
        for (Iterator<String> it = a.keys(); it.hasNext(); ) {
            String k = it.next();
            if (!b.has(k) || a.optDouble(k) != b.optDouble(k)) return false;
        }
        return true;
    }

    private static void notify(Context c, NotificationManager nm, String id, String title, String text, String url) {
        Intent open = new Intent(c, MainActivity.class).putExtra("id", id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Notification.Builder b = new Notification.Builder(c, "alerts")
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(PendingIntent.getActivity(c, id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .setAutoCancel(true);
        if (url != null) b.addAction(new Notification.Action.Builder(null, "Voir l'offre",
            PendingIntent.getActivity(c, id.hashCode() + 1, new Intent(Intent.ACTION_VIEW, Uri.parse(url)), PendingIntent.FLAG_IMMUTABLE)).build());
        nm.notify(id.hashCode(), b.build());
    }
}
