package site.tiznet.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * ورود با همان کد یک‌بارمصرفی که ربات برای نسخهٔ وب می‌فرستد. هیچ رمز یا توکنی روی گوشی
 * وارد نمی‌شود و نشست، همان نشست امضاشدهٔ سرور است؛ بنابراین دسترسی‌ها دقیقاً همان
 * دسترسی‌های چت/مینی‌اپ است.
 */
class LoginActivity : AppCompatActivity() {

    private val ui = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var prefs: Prefs

    private lateinit var baseInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)
        prefs = (application as App).prefs

        baseInput = findViewById(R.id.baseInput)
        codeInput = findViewById(R.id.codeInput)
        statusText = findViewById(R.id.statusText)
        val openBot = findViewById<Button>(R.id.openBotButton)
        val login = findViewById<Button>(R.id.loginButton)

        baseInput.setText(prefs.baseUrl)
        prefs.accountName.takeIf { it.isNotBlank() }?.let {
            setStatus("آخرین حساب: $it — برای ورود مجدد کد بگیرید.", false)
        }

        openBot.setOnClickListener { requestCode() }
        login.setOnClickListener { signIn() }

        if (prefs.cookie.isNotBlank()) {
            setStatus("بررسی نشست قبلی…", false)
            ui.launch { resumeSession() }
        }
    }

    private fun requestCode() {
        val base = Prefs.normalizeBaseText(baseInput.text.toString())
        if (!base.startsWith("https://")) {
            setStatus("آدرس باید با https:// شروع شود.", true)
            return
        }
        prefs.baseUrl = base
        baseInput.setText(base)
        setStatus("در حال گرفتن نام ربات از سرور…", false)
        ui.launch {
            try {
                val result = Api.session(base, null)
                val bot = result.json.optString("bot_username").ifBlank {
                    result.json.optJSONObject("profile")?.optString("bot_username") ?: ""
                }
                if (bot.isBlank()) {
                    setStatus("سرور نام ربات را برنگرداند؛ آدرس را بررسی کنید.", true)
                    return@launch
                }
                openTelegramBot(bot)
                setStatus("در تلگرام، دکمهٔ «دریافت کد» را بزنید و کد آمده را همین‌جا وارد کنید.", false)
            } catch (e: Exception) {
                setStatus("اتصال به سرور برقرار نشد: " + (e.message ?: "خطای شبکه"), true)
            }
        }
    }

    private fun openTelegramBot(username: String) {
        val url = "https://t.me/" + username.removePrefix("@") + "?start=web_login"
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            setStatus("تلگرام روی گوشی پیدا نشد؛ دستی به t.me/$username بروید.", true)
        }
    }

    private fun signIn() {
        val base = Prefs.normalizeBaseText(baseInput.text.toString())
        val code = codeInput.text.toString().trim().uppercase().replace(Regex("[^A-Z0-9]"), "")
        if (code.length < 4) {
            setStatus("کد ورود را کامل وارد کنید.", true)
            return
        }
        prefs.baseUrl = base
        setStatus("در حال ورود…", false)
        ui.launch {
            try {
                val result = Api.login(base, code)
                val cookie = result.cookie
                if (cookie.isNullOrBlank()) {
                    setStatus("سرور نشست نداد؛ کد تازه بگیرید.", true)
                    return@launch
                }
                prefs.cookie = cookie
                val user = result.json.optJSONObject("user")
                prefs.accountName = user?.optString("first_name").orEmpty().ifBlank {
                    user?.optString("username").orEmpty()
                }
                prefs.accountId = user?.optString("id").orEmpty()
                val boot = Api.bootstrap(prefs)
                prefs.role = boot.optString("role")
                if (prefs.role != "admin") {
                    setStatus("این حساب مدیر ربات نیست؛ با حساب مدیر وارد شوید.", true)
                    prefs.clearSession()
                    return@launch
                }
                openMain()
            } catch (e: Api.ApiError) {
                setStatus(Api.errorText(e.code), true)
            } catch (e: Exception) {
                setStatus("ورود انجام نشد: " + (e.message ?: "خطای شبکه"), true)
            }
        }
    }

    private suspend fun resumeSession() {
        try {
            val result = Api.session(prefs.baseUrl, prefs.cookie)
            if (result.status == 200 && result.json.optBoolean("ok", false)) {
                val boot = Api.bootstrap(prefs)
                prefs.role = boot.optString("role")
                if (prefs.role == "admin") {
                    openMain()
                    return
                }
            }
            prefs.clearSession()
            withContext(Dispatchers.Main) { setStatus("نشست قبلی منقضی شده؛ کد تازه بگیرید.", true) }
        } catch (e: Exception) {
            withContext(Dispatchers.Main) { setStatus("آفلاین هستید یا سرور پاسخ نداد.", true) }
        }
    }

    private fun openMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    private fun setStatus(message: String, isError: Boolean) {
        statusText.text = message
        statusText.setTextColor(
            ContextCompat.getColor(this, if (isError) R.color.tz_warn else R.color.tz_muted)
        )
    }

    override fun onDestroy() {
        ui.cancel()
        super.onDestroy()
    }
}
