package site.tiznet.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * بعد از روشن‌شدن گوشی (یا آپدیت اپ) سرویس همیشه‌فعال را دوباره بالا می‌آورد.
 *
 * اندروید اجازه می‌دهد از BOOT_COMPLETED سرویس foreground شروع شود، پس با یک بار
 * «راه‌اندازی کامل» در اپ، بعد از هر ری‌استارت هم تأیید خودکار واریز برمی‌گردد.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != ACTION_QUICKBOOT &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return

        val app = context.applicationContext as? App ?: return
        val prefs = app.prefs
        if (!prefs.guardEnabled) return
        GuardService.start(context)
        prefs.addLog("🔁 پس از راه‌اندازی گوشی، سرویس خودکار روشن شد")
    }

    companion object {
        private const val ACTION_QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON"
    }
}
