package site.tiznet.app

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * همهٔ مجوزهای زمان‌اجرا و شرایط «اجرای پس‌زمینه» یک‌جا بررسی و درخواست می‌شوند.
 *
 * چرا لازم است: تأیید خودکار واریز یعنی گوشی باید در پس‌زمینه زنده بماند و پیامک بانک را
 * بگیرد. اندروید سه چیز را جدا کنترل می‌کند:
 *  ۱) مجوز خواندن پیامک (RECEIVE_SMS) — دیالوگ زمان‌اجرا
 *  ۲) اجازهٔ اعلان (Android 13+) — برای گزارش نتیجهٔ تأیید
 *  ۳) معافیت از بهینه‌سازی باتری — تنها راه رسمی اینکه سیستم اپ را در پس‌زمینه نکشد
 * به‌علاوهٔ سرویس همیشه‌فعال (GuardService) که وضعیت زنده را در نوار اعلان نشان می‌دهد.
 */
object Perms {

    const val SMS = Manifest.permission.RECEIVE_SMS
    const val NOTIFICATIONS = Manifest.permission.POST_NOTIFICATIONS

    /** مجوزهای زمان‌اجرایی که هنوز داده نشده‌اند (فقط موارد لازم برای همین نسخهٔ اندروید). */
    fun missingRuntime(ctx: Context): Array<String> {
        val out = ArrayList<String>()
        if (!sms(ctx)) out.add(SMS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notifications(ctx)) out.add(NOTIFICATIONS)
        return out.toTypedArray()
    }

    fun sms(ctx: Context): Boolean = granted(ctx, SMS)

    fun notifications(ctx: Context): Boolean = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    /** اپ از بهینه‌سازی باتری معاف است؟ تنها شاخص رسمی «اجازهٔ اجرا در پس‌زمینه». */
    fun battery(ctx: Context): Boolean {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return true
        return try {
            pm.isIgnoringBatteryOptimizations(ctx.packageName)
        } catch (e: Exception) {
            false
        }
    }

    fun granted(ctx: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

    /**
     * اینتنت دیالوگ سیستمی معافیت باتری. اگر سیستم اجازه نداد، صفحهٔ فهرست باتری و در
     * نهایت صفحهٔ خود اپ باز می‌شود تا هیچ‌وقت بن‌بست نباشد.
     */
    fun batteryIntent(ctx: Context): Intent {
        val pkg = Uri.parse("package:" + ctx.packageName)
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)
        if (resolves(ctx, direct)) return direct
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        if (resolves(ctx, list)) return list
        return appDetails(ctx)
    }

    fun appDetails(ctx: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))

    /**
     * اجرای خودکار پس از ری‌استارت در گوشی‌های چینی معمولاً بسته است و هیچ API رسمی هم
     * ندارد؛ صفحهٔ تنظیمات سازنده را باز می‌کنیم. اگر نبود، صفحهٔ خود اپ باز می‌شود.
     */
    fun openAutostart(ctx: Context) {
        for (component in AUTOSTART_SCREENS) {
            val intent = Intent().setComponent(component).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (!resolves(ctx, intent)) continue
            try {
                ctx.startActivity(intent)
                return
            } catch (e: Exception) {
                // صفحهٔ سازنده در دسترس نبود؛ بعدی را امتحان کن.
            }
        }
        try {
            ctx.startActivity(appDetails(ctx).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            // هیچ صفحه‌ای باز نشد؛ متن راهنما در خود اپ هست.
        }
    }

    /** نام سازنده برای راهنمای کوتاه «اجرای پس‌زمینه» در رابط. */
    fun vendorHint(): String {
        val maker = (Build.MANUFACTURER ?: "").lowercase()
        val brand = (Build.BRAND ?: "").lowercase()
        return when {
            maker.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco") ->
                "در MIUI: تنظیمات ← اپ‌ها ← تیزنت ← Autostart را روشن کنید و Battery saver را روی «No restrictions» بگذارید."
            maker.contains("huawei") || brand.contains("honor") ->
                "در EMUI: تنظیمات ← باتری ← App launch ← تیزنت ← Manage manually و هر سه گزینه را روشن کنید."
            maker.contains("oppo") || brand.contains("realme") || brand.contains("oneplus") ->
                "در ColorOS: تنظیمات ← باتری ← App battery management ← تیزنت ← Allow background activity."
            maker.contains("vivo") || brand.contains("iqoo") ->
                "در Funtouch: تنظیمات ← باتری ← High background power consumption ← تیزنت را مجاز کنید."
            maker.contains("samsung") ->
                "در One UI: تنظیمات ← باتری ← Limits ← تیزنت را به «Unrestricted» تغییر دهید."
            else -> "در تنظیمات باتری گوشی، تیزنت را از فهرست اپ‌های محدودشده بردارید."
        }
    }

    private fun resolves(ctx: Context, intent: Intent): Boolean = try {
        // بدون MATCH_DEFAULT_ONLY تا اینتنت‌های سیستمی که فیلتر پیش‌فرض ندارند هم پیدا شوند.
        ctx.packageManager.queryIntentActivities(intent, 0).isNotEmpty()
    } catch (e: Exception) {
        false
    }

    /** برای نمایش در رابط: هر ردیف = (برچسب، برقرار؟، کلید). */
    fun checklist(activity: Activity): List<Row> = listOf(
        Row("اجازهٔ خواندن پیامک", sms(activity), KIND_SMS,
            "بدون این مجوز هیچ پیامکی خوانده نمی‌شود."),
        Row("اجازهٔ اعلان", notifications(activity), KIND_NOTIFY,
            "نتیجهٔ تأیید واریز در نوار اعلان دیده می‌شود."),
        Row("اجرا در پس‌زمینه (معاف از محدودیت باتری)", battery(activity), KIND_BATTERY,
            "تا اندروید اپ را در سکوت متوقف نکند."),
        Row("سرویس همیشه‌فعال", GuardService.isRunning(activity), KIND_GUARD,
            "اعلان کوچک دائمی نشان می‌دهد اپ زنده است.")
    )

    data class Row(val title: String, val ok: Boolean, val kind: Int, val hint: String)

    const val KIND_SMS = 1
    const val KIND_NOTIFY = 2
    const val KIND_BATTERY = 3
    const val KIND_GUARD = 4

    private val AUTOSTART_SCREENS = listOf(
        ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
        ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
        ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
        ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
        ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
        ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
        ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
        ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
        ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"),
        ComponentName("com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"),
        ComponentName("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity")
    )
}
