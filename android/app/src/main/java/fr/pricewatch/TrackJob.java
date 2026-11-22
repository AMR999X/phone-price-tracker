package fr.pricewatch;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** Background price check every 3 hours, survives reboots. Android may delay it a bit to save battery. */
public class TrackJob extends JobService {
    private static final int ID = 1;
    private static final long PERIOD = 3_600_000L; // hourly

    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        JobInfo cur = js.getPendingJob(ID);
        if (cur != null && cur.getIntervalMillis() == PERIOD) return; // reschedules v1.0's 3-hour job
        js.schedule(new JobInfo.Builder(ID, new ComponentName(c, TrackJob.class))
            .setPeriodic(PERIOD)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> { Tracker.run(getApplicationContext()); jobFinished(params, false); }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }
}
