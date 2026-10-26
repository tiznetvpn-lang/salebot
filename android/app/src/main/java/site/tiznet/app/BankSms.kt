package site.tiznet.app

/**
 * خواندن پیامک بانکی. همین قاعده در ربات هم برای «واریز بی‌صاحب» استفاده می‌شود:
 * فقط واریز واقعی، بدون رمز پویا، بدون برگشت، با مبلغ قابل تبدیل دقیق به تومان.
 * برخلاف اپ قبلی، ناشناس‌بودن بانک یا نبودِ کد پیگیری مانع ارسال نیست؛ چون سرور
 * فقط مبلغ یکتا را تطبیق می‌دهد و کد پیگیری فقط برای دفتر رویداد است.
 */
object BankSms {

    data class Deposit(
        val bank: String,
        val amountRial: Long,
        val reference: String,
        val eligible: Boolean,
        val reason: String
    ) {
        val amountToman: Long get() = amountRial / 10L
    }

    private val banks = listOf(
        "ملی" to listOf("bankmelli", "melli", "6104"),
        "ملت" to listOf("bankmellat", "mellat", "610433"),
        "صادرات" to listOf("saderat", "bsi", "6037"),
        "تجارت" to listOf("tejarat", "btejarat", "5859"),
        "سپه" to listOf("sepah", "5892"),
        "پاسارگاد" to listOf("pasargad", "bpi", "5022"),
        "سامان" to listOf("saman", "6219"),
        "پارسیان" to listOf("parsian", "6221"),
        "کشاورزی" to listOf("keshavarzi", "bki"),
        "رفاه" to listOf("refah", "5833"),
        "مسکن" to listOf("maskan", "6290"),
        "شهر" to listOf("shahr", "5047"),
        "اقتصاد نوین" to listOf("enbank", "6274"),
        "سینا" to listOf("sina", "6393"),
        "بلوبانک" to listOf("blubank", "blue"),
        "آینده" to listOf("ayandeh", "ba24"),
        "پست بانک" to listOf("postbank"),
        "خاورمیانه" to listOf("middleeast", "mbank"),
        "کارآفرین" to listOf("karafarin"),
        "گردشگری" to listOf("gardeshgari"),
        "رسالت" to listOf("resalat"),
        "مهر ایران" to listOf("mehr"),
        "دی" to listOf("bankday")
    )

    private val creditWords = listOf(
        "واریز", "به حساب شما", "به حساب", "دریافت", "کارت‌به‌کارت", "کارت به کارت",
        "پایا", "ساتنا", "شتاب", "وجه به حساب", "مبلغ واریز", "واریزی", "اعتبار",
        "افزایش موجودی", "به شما"
    )

    private val debitWords = listOf(
        "برداشت", "کاهش موجودی", "خرید", "پرداخت شد", "پرداخت موفق", "انتقال به",
        "کارت شما", "کسر", "بدهکار", "طلب", "شماره کارت شما"
    )

    private val otpWords = listOf(
        "رمز پویا", "رمز یکبار", "رمز یک بار", "رمز دوم", "کد تایید", "کد تأیید",
        "کد فعال‌سازی", "کد ورود", "رمز اینترنتی", "cvv2", "otp"
    )

    private val reversalWords = listOf("برگشت", "کنسل", "لغو", "reverse", "عودت", "ناموفق")

    private val refRegex = Regex(
        "(?:کد\\s*(?:پیگیری|رهگیری|مرجع|تراکنش)|شماره\\s*(?:پیگیری|رهگیری|مرجع|تراکنش|سند)|شناسه\\s*(?:پیگیری|تراکنش)|پیگیری|رهگیری|مرجع|رسید|trace|ref)[^\\d]{0,15}(\\d{4,})",
        RegexOption.IGNORE_CASE
    )

    fun detectBank(sender: String): String {
        val normalized = sender.lowercase().replace(" ", "")
        val hit = banks.firstOrNull { (_, keys) -> keys.any { normalized.contains(it) } }
        return hit?.first ?: ""
    }

    fun parse(sender: String, body: String): Deposit {
        val text = normalize(body)
        val lower = text.lowercase()
        val bank = detectBank(sender)
        val isOtp = otpWords.any { lower.contains(it) }
        val isReversal = reversalWords.any { lower.contains(it) }
        val hasCredit = creditWords.any { lower.contains(it) }
        val hasDebit = debitWords.any { lower.contains(it) }
        val amountRial = extractRial(text)
        val reference = refRegex.find(text)?.groupValues?.getOrNull(1) ?: ""

        val reason = when {
            isOtp -> "رمز پویا/کد تأیید است"
            isReversal -> "برگشت یا تراکنش ناموفق است"
            !hasCredit -> "پیامک واریز نیست"
            hasDebit -> "پیامک برداشت است"
            amountRial <= 0L -> "مبلغ خوانده نشد"
            amountRial % 10L != 0L -> "مبلغ به تومان دقیق تبدیل نمی‌شود"
            else -> ""
        }
        return Deposit(
            bank = bank.ifBlank { "بانک نامشخص" },
            amountRial = maxOf(amountRial, 0L),
            reference = reference,
            eligible = reason.isEmpty(),
            reason = reason
        )
    }

    /** مبلغ همیشه به ریال برمی‌گردد؛ «تومان» ضرب در ۱۰ و «ریال» دست‌نخورده. */
    private fun extractRial(text: String): Long {
        val withUnit = Regex("([\\d][\\d,٬]{2,})\\s*(ریال|ريال|تومان|تومن)").find(text)
        if (withUnit != null) {
            val value = toNumber(withUnit.groupValues[1])
            val unit = withUnit.groupValues[2]
            return if (unit.contains("توم")) value * 10L else value
        }
        val fallback = Regex("(?:مبلغ|به مبلغ|واریز|واریزی)\\s*:?\\s*([\\d][\\d,٬]{2,})").find(text)
            ?: Regex("([\\d][\\d,٬]{2,})").find(text)
        val value = fallback?.groupValues?.getOrNull(1)?.let { toNumber(it) } ?: 0L
        // بدون واحد: مبالغ کوچک تومان‌اند و بزرگ‌ها ریال (رایج‌ترین حالت پیامک بانک‌ها)
        return if (value in 1L until 1_000_000L) value * 10L else value
    }

    private fun toNumber(raw: String): Long =
        raw.replace(",", "").replace("٬", "").toLongOrNull() ?: 0L

    private fun normalize(body: String): String {
        val sb = StringBuilder(body.length)
        for (ch in body) {
            sb.append(
                when {
                    ch in '۰'..'۹' -> '0' + (ch - '۰')
                    ch in '٠'..'٩' -> '0' + (ch - '٠')
                    ch == '\u200c' -> ' '
                    ch == 'ي' -> 'ی'
                    ch == 'ك' -> 'ک'
                    else -> ch
                }
            )
        }
        return sb.toString().replace(Regex("\\s+"), " ").trim()
    }
}
