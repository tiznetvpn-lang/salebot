package site.tiznet.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * کلاینت REST اپ. هیچ منطق تجاری این‌جا نیست: همان endpointهایی صدا زده می‌شوند که
 * مینی‌اپ و ربات استفاده می‌کنند، با همان هویت (نشست امضاشدهٔ سرور) — بنابراین اپ و
 * مینی‌اپ هرگز از هم جدا نمی‌افتند.
 */
object Api {

    data class Result(val status: Int, val json: JSONObject, val cookie: String?)

    class ApiError(val status: Int, val code: String) : Exception(code)

    private const val CONFIRM_PATH = "/wp-json/webdide-cv/v1/confirm"
    private const val HEALTH_PATH = "/wp-json/webdide-cv/v1/health"
    private const val STATUS_PATH = "/wp-json/webdide-cv/v1/status"

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    // ── زیرساخت ────────────────────────────────────────────────────────────

    private suspend fun request(
        method: String,
        base: String,
        path: String,
        cookie: String? = null,
        body: JSONObject? = null,
        authHeader: String? = null
    ): Result = withContext(Dispatchers.IO) {
        val url = base.trimEnd('/') + path
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (!cookie.isNullOrBlank()) builder.header("Cookie", cookie)
        if (!authHeader.isNullOrBlank()) builder.header("Authorization", authHeader)
        if (method == "POST") {
            builder.post((body ?: JSONObject()).toString().toRequestBody(jsonType))
        } else {
            builder.get()
        }
        client.newCall(builder.build()).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val json = try {
                if (raw.trimStart().startsWith("{")) JSONObject(raw) else JSONObject()
            } catch (e: Exception) {
                JSONObject()
            }
            var cookieValue: String? = null
            response.headers("Set-Cookie").forEach { header ->
                val first = header.substringBefore(';')
                if (first.startsWith("tzs=")) cookieValue = first
            }
            Result(response.code, json, cookieValue)
        }
    }

    private fun ok(result: Result): JSONObject {
        if (result.status in 200..299 && result.json.optBoolean("ok", true)) return result.json
        val code = result.json.optString("error").ifBlank { "http_" + result.status }
        throw ApiError(result.status, code)
    }

    // ── ورود با کد یک‌بارمصرف ربات (همان مسیر نسخهٔ وب) ─────────────────────

    suspend fun session(base: String, cookie: String?): Result =
        request("GET", base, "/api/web/session", cookie)

    suspend fun login(base: String, code: String): Result =
        request("POST", base, "/api/web/login", null, JSONObject().put("code", code))

    suspend fun logout(base: String, cookie: String?) {
        try { request("POST", base, "/api/web/logout", cookie) } catch (_: Exception) { }
    }

    // ── دادهٔ مدیریتی (همان API مینی‌اپ) ─────────────────────────────────────

    suspend fun bootstrap(prefs: Prefs): JSONObject =
        ok(request("GET", prefs.baseUrl, "/api/miniapp/bootstrap", prefs.cookie))

    suspend fun summary(prefs: Prefs, days: Int = 30): JSONObject =
        ok(request("GET", prefs.baseUrl, "/api/miniapp/admin/summary?days=$days", prefs.cookie))

    suspend fun orders(prefs: Prefs, status: String = "all", query: String = "", limit: Int = 30): JSONObject {
        val q = java.net.URLEncoder.encode(query, "UTF-8")
        return ok(request("GET", prefs.baseUrl, "/api/miniapp/admin/orders?status=$status&q=$q&limit=$limit&days=0", prefs.cookie))
    }

    suspend fun orderAction(
        prefs: Prefs,
        orderId: String,
        action: String,
        reason: String = "",
        paymentReceivedConfirmed: Boolean = false
    ): JSONObject {
        val body = JSONObject().put("action", action)
        if (reason.isNotBlank()) body.put("reason", reason)
        if (paymentReceivedConfirmed) body.put("payment_received_confirmed", true)
        return ok(request("POST", prefs.baseUrl, "/api/miniapp/admin/orders/$orderId", prefs.cookie, body))
    }

    suspend fun customers(prefs: Prefs, query: String = "", limit: Int = 40): JSONObject {
        val q = java.net.URLEncoder.encode(query, "UTF-8")
        return ok(request("GET", prefs.baseUrl, "/api/miniapp/admin/customers?q=$q&limit=$limit", prefs.cookie))
    }

    suspend fun shetabApp(prefs: Prefs): JSONObject =
        ok(request("GET", prefs.baseUrl, "/api/miniapp/admin/shetab-app", prefs.cookie))

    // ── قرارداد Shetab: همان چیزی که ربات و اپ گوشی استفاده می‌کنند ──────────

    suspend fun confirm(base: String, secret: String, amountToman: Long, reference: String): JSONObject {
        val response = request(
            "POST", base, CONFIRM_PATH, null,
            JSONObject().put("amount", amountToman).put("recipeId", reference.take(100)),
            secret
        )
        return response.json
    }

    suspend fun depositStatus(base: String, orderId: String): JSONObject =
        request("GET", base, STATUS_PATH + "?order_id=" + java.net.URLEncoder.encode(orderId, "UTF-8")).json

    suspend fun health(base: String, secret: String): Result =
        request("GET", base, HEALTH_PATH, null, null, secret)

    fun endpointFor(base: String): String = base.trimEnd('/') + CONFIRM_PATH

    // ── ترجمهٔ خطاها به فارسی ───────────────────────────────────────────────

    fun errorText(code: String): String = when (code) {
        "unauthorized" -> "نشست منقضی شده؛ دوباره وارد شوید."
        "account_blocked" -> "این حساب مسدود است."
        "invalid_code" -> "کد واردشده معتبر یا تازه نیست؛ از ربات کد تازه بگیرید."
        "code_required" -> "کد ورود را وارد کنید."
        "too_many_attempts" -> "تلاش‌های زیاد؛ چند دقیقه بعد دوباره تلاش کنید."
        "order_not_pending" -> "این سفارش دیگر در انتظار نیست."
        "payment_not_verified" -> "پرداخت این سفارش تأیید نشده؛ با «تأیید دستی» ثبتش کنید."
        "paid_order_cannot_reject" -> "سفارش پرداخت‌شده را نمی‌توان رد کرد."
        "order_action_processing" -> "یک عملیات دیگر روی این سفارش در جریان است؛ چند لحظه بعد."
        "order_not_found" -> "سفارش پیدا نشد."
        "admin_required" -> "این حساب مدیر نیست."
        "secret_missing" -> "Secret پرداخت در سرور ساخته نشده است."
        "secret_mismatch" -> "Secret اپ با سرور یکی نیست؛ در تنظیمات «همگام‌سازی» را بزنید."
        "rate_limited" -> "درخواست‌ها موقتاً محدود شده‌اند."
        "ambiguous_amount" -> "چند سفارش با این مبلغ هست؛ ربات برای بررسی به مدیر هشدار داد."
        "no_order_match" -> "سفارشی با این مبلغ پیدا نشد."
        "order_closed" -> "سفارش بسته یا منقضی شده است."
        "amount_required" -> "مبلغ معتبر خوانده نشد."
        else -> if (code.startsWith("http_")) "خطای سرور (${code.removePrefix("http_")})" else code
    }
}
