package site.tiznet.app

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

/**
 * تنظیمات و وضعیت محلی اپ. همه‌چیز در حافظهٔ خصوصی خود اپ است؛ اگر Keystore در دسترس
 * بود رمزگذاری هم می‌شود. هیچ دادهٔ مشتری روی گوشی ذخیره نمی‌شود؛ فهرست‌ها همیشه از سرور
 * می‌آیند تا اپ و ربات دقیقاً یک منبع داده داشته باشند.
 */
class Prefs(context: Context) {

    private val sp: SharedPreferences = build(context.applicationContext)

    private fun build(ctx: Context): SharedPreferences = try {
        val masterKey = MasterKey.Builder(ctx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            ctx,
            "tiznet_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        ctx.getSharedPreferences("tiznet_plain", Context.MODE_PRIVATE)
    }

    var baseUrl: String
        get() = sp.getString(KEY_BASE, DEFAULT_BASE) ?: DEFAULT_BASE
        set(value) = sp.edit().putString(KEY_BASE, normalizeBaseText(value)).apply()

    /** کوکی نشست سرور (`tzs=...`) — فقط سمت سرور معنی دارد و در بکاپ اپ نمی‌آید. */
    var cookie: String
        get() = sp.getString(KEY_COOKIE, "") ?: ""
        set(value) = sp.edit().putString(KEY_COOKIE, value).apply()

    var accountName: String
        get() = sp.getString(KEY_ACCOUNT, "") ?: ""
        set(value) = sp.edit().putString(KEY_ACCOUNT, value).apply()

    var accountId: String
        get() = sp.getString(KEY_ACCOUNT_ID, "") ?: ""
        set(value) = sp.edit().putString(KEY_ACCOUNT_ID, value).apply()

    var role: String
        get() = sp.getString(KEY_ROLE, "") ?: ""
        set(value) = sp.edit().putString(KEY_ROLE, value).apply()

    /** سوییچ تأیید خودکار واریز از روی پیامک بانکی. */
    var smsConfirmEnabled: Boolean
        get() = sp.getBoolean(KEY_SMS_ENABLED, false)
        set(value) = sp.edit().putBoolean(KEY_SMS_ENABLED, value).apply()

    var shetabSecret: String
        get() = sp.getString(KEY_SECRET, "") ?: ""
        set(value) = sp.edit().putString(KEY_SECRET, value).apply()

    var shetabEndpoint: String
        get() = sp.getString(KEY_ENDPOINT, "") ?: ""
        set(value) = sp.edit().putString(KEY_ENDPOINT, value).apply()

    var lastSecretSyncAt: Long
        get() = sp.getLong(KEY_SECRET_AT, 0L)
        set(value) = sp.edit().putLong(KEY_SECRET_AT, valueL(value)).apply()

    /** سرویس همیشه‌فعال (اعلان دائمی) روشن باشد؟ پیش‌فرض بله. */
    var guardEnabled: Boolean
        get() = sp.getBoolean(KEY_GUARD, true)
        set(value) = sp.edit().putBoolean(KEY_GUARD, value).apply()

    /** آیا کاربر یک‌بار مسیر مجوزها (پیامک + اعلان + باتری) را کامل کرده است؟ */
    var setupDone: Boolean
        get() = sp.getBoolean(KEY_SETUP, false)
        set(value) = sp.edit().putBoolean(KEY_SETUP, value).apply()

    fun clearSession() {
        sp.edit().remove(KEY_COOKIE).remove(KEY_ACCOUNT).remove(KEY_ACCOUNT_ID).remove(KEY_ROLE).apply()
    }

    /** گزارش کوچک از آخرین واریزهای خوانده‌شده؛ حداکثر ۴۰ ردیف، بدون شمارهٔ کارت. */
    fun addLog(line: String) {
        val list = JSONArray()
        val trimmed = if (line.length > 300) line.take(300) else line
        list.put(JSONObject().put("at", System.currentTimeMillis()).put("text", trimmed))
        val old = JSONArray(sp.getString(KEY_LOG, "[]") ?: "[]")
        for (i in 0 until minOf(old.length(), LOG_ROWS - 1)) list.put(old.getJSONObject(i))
        sp.edit().putString(KEY_LOG, list.toString()).apply()
    }

    fun logs(): List<Pair<Long, String>> {
        val out = ArrayList<Pair<Long, String>>()
        val arr = try { JSONArray(sp.getString(KEY_LOG, "[]") ?: "[]") } catch (e: Exception) { JSONArray() }
        for (i in 0 until arr.length()) {
            val row = arr.optJSONObject(i) ?: continue
            out.add(Pair(row.optLong("at"), row.optString("text")))
        }
        return out
    }

    fun clearLogs() = sp.edit().remove(KEY_LOG).apply()

    /**
     * جلوگیری از ارسال دوبارهٔ یک پیامک. بانک ممکن است پیامک چندبخشی را دو بار به
     * گیرنده برساند؛ کلید یکتای هر واریز ۲۰ دقیقه نگه داشته می‌شود.
     */
    fun sentRecently(key: String, windowMs: Long): Boolean {
        val map = sentMap()
        val at = map.optLong(key, 0L)
        return at > 0 && System.currentTimeMillis() - at < windowMs
    }

    fun markSent(key: String) {
        val map = sentMap()
        val now = System.currentTimeMillis()
        val fresh = JSONObject()
        var kept = 0
        val keys = map.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            val at = map.optLong(k, 0L)
            if (now - at < 24 * 3600 * 1000L && kept < 20) {
                fresh.put(k, at)
                kept++
            }
        }
        fresh.put(key, now)
        sp.edit().putString(KEY_SENT, fresh.toString()).apply()
    }

    private fun sentMap(): JSONObject = try {
        JSONObject(sp.getString(KEY_SENT, "{}") ?: "{}")
    } catch (e: Exception) {
        JSONObject()
    }

    private fun valueL(v: Long) = v

    companion object {
        const val DEFAULT_BASE = "https://bot.tiznet.site"
        private const val KEY_BASE = "base_url"
        private const val KEY_COOKIE = "session_cookie"
        private const val KEY_ACCOUNT = "account_name"
        private const val KEY_ACCOUNT_ID = "account_id"
        private const val KEY_ROLE = "account_role"
        private const val KEY_SMS_ENABLED = "sms_confirm_enabled"
        private const val KEY_SECRET = "shetab_secret"
        private const val KEY_ENDPOINT = "shetab_endpoint"
        private const val KEY_SECRET_AT = "shetab_secret_synced_at"
        private const val KEY_GUARD = "guard_enabled"
        private const val KEY_SETUP = "setup_done"
        private const val KEY_LOG = "sms_log"
        private const val KEY_SENT = "sms_sent"
        private const val LOG_ROWS = 40

        /** فقط https؛ اگر کاربر آدرس کامل مسیر confirm را داد، به ریشه کوتاه می‌شود. */
        fun normalizeBaseText(input: String): String {
            var text = input.trim()
            if (text.isEmpty()) return DEFAULT_BASE
            if (!text.startsWith("http://") && !text.startsWith("https://")) text = "https://$text"
            text = text.trimEnd('/')
            val marker = "/wp-json"
            val idx = text.indexOf(marker)
            if (idx > 0) text = text.substring(0, idx)
            return text.trimEnd('/')
        }
    }
}
