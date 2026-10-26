package site.tiznet.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * پیامک بانکی → تأیید خودکار واریز در ربات.
 *
 * این اپ هیچ حسابداری محلی ندارد؛ فقط همان کاری را می‌کند که اپ Shetab می‌کرد:
 * مبلغ واریز را به «تومان» تبدیل و به `POST /wp-json/webdide-cv/v1/confirm` می‌فرستد.
 * پس منبع حقیقت همان KV ربات است و اپ هیچ‌وقت با آن اختلاف پیدا نمی‌کند.
 */
class BankSmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val app = context.applicationContext as? App ?: return
        val prefs = app.prefs
        if (!prefs.smsConfirmEnabled) return

        val grouped = parts.groupBy { it.originatingAddress ?: "" }
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                for ((sender, group) in grouped) {
                    val body = group.joinToString("") { it.messageBody ?: "" }
                    val deposit = BankSms.parse(sender, body)
                    handle(app, deposit)
                }
            } finally {
                pending.finish()
            }
        }
    }

    private suspend fun handle(app: App, deposit: BankSms.Deposit) {
        val prefs = app.prefs
        if (!deposit.eligible) {
            if (deposit.amountRial > 0) {
                prefs.addLog("⏭ رد شد — ${deposit.reason} · ${fa(deposit.amountToman)} تومان")
            }
            return
        }
        if (deposit.amountRial > MAX_RIAL) {
            prefs.addLog("⏭ مبلغ بزرگ‌تر از سقف امن — ${fa(deposit.amountToman)} تومان")
            return
        }
        val secret = prefs.shetabSecret
        if (secret.isBlank()) {
            prefs.addLog("⚠️ Secret همگام نشده — ${fa(deposit.amountToman)} تومان ارسال نشد")
            return
        }
        val reference = deposit.reference.ifBlank { "SMS-" + System.currentTimeMillis() }
        val dedupeKey = "${deposit.amountRial}|$reference"
        if (prefs.sentRecently(dedupeKey, 20 * 60 * 1000L)) return

        val result = try {
            Api.confirm(prefs.baseUrl, secret, deposit.amountToman, reference)
        } catch (e: Exception) {
            prefs.addLog("❌ خطای شبکه — ${fa(deposit.amountToman)} تومان (${e.message ?: "بدون پاسخ"})")
            return
        }
        val success = result.optBoolean("success", false)
        val confirmed = result.optBoolean("payment_confirmed", false) || result.optBoolean("already_processed", false)
        val orderId = result.optString("order_id", "")
        if (success && confirmed) {
            prefs.markSent(dedupeKey)
            val line = "✅ تأیید شد — ${fa(deposit.amountToman)} تومان" +
                (if (orderId.isNotBlank()) " · سفارش $orderId" else " · سفارش تکراری")
            prefs.addLog(line)
            app.notify("واریز تأیید شد", line + " · " + stamp())
        } else {
            val reason = result.optString("reason", "")
            prefs.addLog("❌ تأیید نشد — ${fa(deposit.amountToman)} تومان" + if (reason.isNotBlank()) " · $reason" else "")
        }
    }

    companion object {
        private const val MAX_RIAL = 500_000_000L // ۵۰ میلیون تومان سقف امن

        private fun fa(value: Long): String {
            val text = String.format(Locale.US, "%,d", value).replace(',', '٬')
            return text.map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")
        }

        private fun stamp(): String =
            SimpleDateFormat("HH:mm", Locale.US).format(Date())
    }
}
