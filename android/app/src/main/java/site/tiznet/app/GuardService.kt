package site.tiznet.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * سرویس همیشه‌فعال: یک اعلان کوچک پایدار که به اندروید می‌گوید «این اپ عمداً در حال
 * اجراست». بدون آن، برخی گوشی‌ها بعد از چند ساعت اپ را می‌خوابانند و پیامک واریز تا
 * باز شدن دستی اپ تأیید نمی‌شود.
 *
 * خودِ خواندن پیامک به این سرویس وابسته نیست (BroadcastReceiver سیستم اپ را بیدار می‌کند)،
 * اما این سرویس تماس شبکه‌ای بعد از پیامک را سریع نگه می‌دارد و به کاربر نشان می‌دهد همه‌چیز
 * فعال است. اگر سیستم اجازهٔ اجرا نداد، بی‌صدا رد می‌شود و بقیهٔ اپ سالم کار می‌کند.
 */
class GuardService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val shown = try {
            startAsForeground()
            running = true
            true
        } catch (e: Exception) {
            false
        }
        if (!shown) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    private fun startAsForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 34) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val open = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val pending = PendingIntent.getActivity(this, 0, open, flags)
        val prefs = (applicationContext as? App)?.prefs
        val active = prefs?.smsConfirmEnabled == true
        val text = if (active) {
            "تأیید خودکار واریز روشن است و پیامک بانک‌ها خوانده می‌شود."
        } else {
            "سرویس زنده است؛ برای تأیید واریز، سوییچ را در تب «پیامک بانکی» روشن کنید."
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("تیزنت فعال است")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pending)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "سرویس فعال تیزنت",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "اعلان دائمی برای اینکه سیستم اپ را در پس‌زمینه نبندد"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ID = "tiznet_guard"
        private const val NOTIFICATION_ID = 4711

        @Volatile
        private var running = false

        /** تقریبی و فقط برای نمایش وضعیت در رابط؛ مرجع واقعی، مجوز SMS و معافیت باتری است. */
        fun isRunning(context: Context): Boolean {
            if (!running) return false
            val app = context.applicationContext as? App ?: return running
            return app.prefs.guardEnabled
        }

        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, GuardService::class.java))
            } catch (e: Exception) {
                // اجازهٔ اجرا در پس‌زمینه داده نشده؛ از خود اپ (foreground) یک بار دیگر تلاش می‌کنیم.
                try {
                    context.startService(Intent(context, GuardService::class.java))
                } catch (ignored: Exception) {
                }
            }
        }

        fun stop(context: Context) {
            running = false
            try {
                context.stopService(Intent(context, GuardService::class.java))
            } catch (e: Exception) {
            }
        }
    }
}
