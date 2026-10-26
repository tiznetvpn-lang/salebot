package site.tiznet.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

/**
 * وضعیت سراسری اپ. یک نمونهٔ Prefs و یک کانال نوتیفیکیشن برای همین اپ کافی است؛
 * هیچ داده‌ای جز رشته‌های تنظیمات روی گوشی نگه داشته نمی‌شود.
 */
class App : Application() {

    lateinit var prefs: Prefs
        private set

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        createChannel()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "واریز و سفارش‌ها",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "نتیجهٔ تأیید خودکار واریز و سفارش‌های در انتظار"
        }
        manager.createNotificationChannel(channel)
    }

    /** نوتیفیکیشن محلی؛ اگر مجوز نبود بی‌صدا رد می‌شود تا هیچ عملیاتی نشکند. */
    fun notify(title: String, body: String, id: Int = (System.currentTimeMillis() % 100000).toInt()) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(this).notify(id, notification)
        } catch (_: SecurityException) {
        }
    }

    companion object {
        const val CHANNEL_ID = "tiznet_default"
    }
}
