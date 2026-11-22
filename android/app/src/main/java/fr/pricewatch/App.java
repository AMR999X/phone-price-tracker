package fr.pricewatch;

import android.app.Application;
import android.os.Build;

import java.io.File;
import java.io.PrintWriter;

/** Saves any crash to crash.txt so the next launch can show it (no USB cable / logcat needed). */
public class App extends Application {
    static File crashFile(android.content.Context c) { return new File(c.getFilesDir(), "crash.txt"); }

    static void saveCrash(android.content.Context c, String what, Throwable e) {
        try (PrintWriter w = new PrintWriter(crashFile(c))) {
            w.println(Build.MANUFACTURER + " " + Build.MODEL + ", Android " + Build.VERSION.RELEASE + ", app " + BuildConfig.VERSION_NAME);
            w.println(what);
            if (e != null) e.printStackTrace(w);
        } catch (Exception ignored) { }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            saveCrash(this, "Crash on thread " + t.getName(), e);
            if (prev != null) prev.uncaughtException(t, e);
        });
    }
}
