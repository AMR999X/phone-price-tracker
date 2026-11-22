package fr.pricewatch;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;

/** Shows the website (bundled from public/) with data/*.json served from what the phone has scraped. */
public class MainActivity extends Activity {
    private static final String HOST = "app.local";
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null; // CDN (Chart.js, fonts): normal network
                String path = u.getPath() == null || u.getPath().equals("/") ? "index.html" : u.getPath().substring(1);
                try {
                    File f = path.startsWith("data/") ? new File(getFilesDir(), path.substring(5)) : null;
                    InputStream in = f != null && f.isFile() ? new FileInputStream(f) : getAssets().open(path);
                    return new WebResourceResponse(mime(path), "utf-8", in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (HOST.equals(req.getUrl().getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); // shop / idealo links open in the browser
                return true;
            }
        });
        setContentView(web);
        TrackJob.schedule(this);
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1); // only prompts on Android 13+
        show(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        show(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Opening the app refreshes prices if the last check is over an hour old.
        File latest = new File(getFilesDir(), "latest.json");
        if (latest.exists() && System.currentTimeMillis() - latest.lastModified() < 3_600_000L) return;
        Toast.makeText(this, "Checking prices…", Toast.LENGTH_SHORT).show();
        new Thread(() -> { Tracker.run(getApplicationContext()); runOnUiThread(web::reload); }).start();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    private void show(Intent intent) {
        String id = intent.getStringExtra("id");
        web.loadUrl("https://" + HOST + "/index.html" + (id != null ? "#" + Uri.encode(id) : ""));
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }
}
