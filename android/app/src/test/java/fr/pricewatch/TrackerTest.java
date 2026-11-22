package fr.pricewatch;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.time.Instant;
import java.util.List;

/** Same fixtures as scripts/test.mjs, so the Java port and the JS original agree. */
public class TrackerTest {
    @Test public void parsesOfferBlock() {
        String html = "<ul><li class=\"productOffers-listItem row\">\n"
            + "  <a href=\"/relocator/relocate?offerKey=x&amp;price=489.99&amp;sid=1\">x</a>\n"
            + "  <span class=\"productOffers-listItemTitleInner\">Xiaomi 17T 256 Go &Eacute;dition</span>\n"
            + "  <noscript><img alt=\"Darty.com\"/></noscript></li></ul>";
        List<Tracker.Offer> o = Tracker.parseOffers(html);
        assertEquals(1, o.size());
        assertEquals("Darty.com", o.get(0).shop);
        assertEquals(489.99, o.get(0).price, 0);
        assertEquals("Xiaomi 17T 256 Go Édition", o.get(0).title);
        assertEquals("https://www.idealo.fr/relocator/relocate?offerKey=x&price=489.99&sid=1", o.get(0).url);
    }

    private static JSONObject pt(long t, double a, double b) throws Exception {
        return new JSONObject().put("t", Instant.ofEpochMilli(t).toString()).put("s", new JSONObject().put("A", a).put("B", b));
    }

    @Test public void dealMaths() throws Exception {
        long DAY = Tracker.DAY, t0 = Instant.parse("2026-10-01T00:00:00Z").toEpochMilli();
        JSONArray pts = new JSONArray().put(pt(t0, 500, 520)).put(pt(t0 + 10 * DAY, 505, 520)).put(pt(t0 + 20 * DAY, 450, 520));
        Tracker.Analysis a = Tracker.analyze(pts, t0 + 20 * DAY + DAY / 2, 7);
        assertEquals(450, a.price, 0);
        assertEquals("A", a.shop);
        assertEquals(500, a.usual, 0); // median of 10×500, 10×505, 1×450
        assertTrue(a.isDeal && a.isLow);

        Tracker.Analysis young = Tracker.analyze(new JSONArray().put(pts.get(0)), t0 + 3 * DAY, 7);
        assertNull(young.usual);
        assertFalse(young.isDeal);
        assertNull(Tracker.analyze(new JSONArray(), t0, 7));
    }

    @Test public void pruneDropsFilteredShopsAndRemovedModels() throws Exception {
        java.util.regex.Pattern only = java.util.regex.Pattern.compile("^(Fnac\\.com)( \\(Marketplace\\))?$", java.util.regex.Pattern.CASE_INSENSITIVE);
        JSONObject hp = new JSONObject()
            .put("keep", new JSONObject().put("points", new JSONArray()
                .put(new JSONObject().put("t", "2026-11-01T00:00:00Z").put("s", new JSONObject().put("Fnac.com (Marketplace)", 1).put("TRIMOX", 2)))
                .put(new JSONObject().put("t", "2026-11-02T00:00:00Z").put("s", new JSONObject().put("TRIMOX", 3)))))
            .put("gone", new JSONObject().put("points", new JSONArray()));
        JSONArray products = new JSONArray().put(new JSONObject().put("id", "keep"));
        Tracker.pruneHistory(hp, products, null, only);
        assertFalse(hp.has("gone"));
        JSONArray pts = hp.getJSONObject("keep").getJSONArray("points");
        assertEquals(1, pts.length()); // the TRIMOX-only snapshot is empty after pruning, so it goes
        assertEquals("[\"Fnac.com (Marketplace)\"]", pts.getJSONObject(0).getJSONObject("s").names().toString());
    }

    @Test public void snapshotCompare() throws Exception {
        assertTrue(Tracker.sameSnapshot(new JSONObject().put("A", 1).put("B", 2), new JSONObject().put("B", 2).put("A", 1)));
        assertFalse(Tracker.sameSnapshot(new JSONObject().put("A", 1), new JSONObject().put("A", 2)));
    }
}
