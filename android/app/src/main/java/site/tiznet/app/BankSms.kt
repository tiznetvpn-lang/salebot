package site.tiznet.app

/**
 * خواندن پیامک بانکی و بیرون‌کشیدن **مبلغ واریز** — نه ماندهٔ حساب.
 *
 * ساختار واقعی پیامک واریز (پست بانک و مشابه‌ها):
 *
 *     پست بانک
 *     واريز به کارت: 2972
 *     +1,006,320
 *     1405/08/4
 *     19:51
 *     مانده: 7,425,882 ريال
 *
 * قاعدهٔ طلایی: **مبلغ واریز همان عددی است که بعد از «+» آمده** و بقیهٔ عددها (مانده،
 * شمارهٔ کارت، تاریخ، ساعت، کد پیگیری) نویزند.
 *
 * باگ نسخهٔ قبل: تابع normalize همهٔ فاصله‌ها — از جمله خط‌های جدید — را یکی می‌کرد و بعد
 * «اولین عددی که کنارش ریال آمده» را برمی‌داشت؛ در پیامک بالا آن عدد «مانده: 7,425,882»
 * بود. یعنی اپ ماندهٔ حساب را به‌جای واریز به سرور می‌فرستاد. حالا:
 *  ۱) متن خط‌به‌خط می‌ماند،
 *  ۲) خط‌های «مانده/موجودی/بالانس» و عددهای برچسب‌دار (کارت/شماره/کد/پیگیری) کنار
 *     گذاشته می‌شوند،
 *  ۳) تاریخ و ساعت قبل از جست‌وجو پاک می‌شوند،
 *  ۴) اولویت با عددِ علامت «+» است؛ بعد خطِ حاوی «واریز»؛ و اگر چند مبلغ مبهم بود،
 *     هیچ مبلغی ارسال نمی‌شود (تأیید اشتباه بدتر از تأیید نشدن است).
 */
object BankSms {

    data class Deposit(
        val bank: String,
        val amountRial: Long,
        val reference: String,
        val eligible: Boolean,
        val reason: String,
        /** همان خطی که مبلغ از آن خوانده شد؛ برای گزارش و رفع اشکال. */
        val source: String = ""
    ) {
        val amountToman: Long get() = amountRial / 10L
    }

    /** یک عدد کاندید داخل پیامک همراه با خطی که در آن آمده. */
    private data class Cand(
        val value: Long,
        val sign: Char,
        val start: Int,
        val line: String,
        val before: String,
        val after: String,
        val isBalance: Boolean,
        val isLabel: Boolean
    )

    /** نتیجهٔ انتخاب مبلغ: ریال، خط منبع، و اگر مشکلی بود دلیلش. */
    private class Pick(val rial: Long, val line: String, val problem: String)

    /** کمتر از ۱٬۰۰۰ تومان هیچ‌وقت مبلغ یک واریز واقعی نیست. */
    private const val MIN_AMOUNT = 10_000L

    /** بالاتر از ۱۰ میلیارد ریال (یک میلیارد تومان) قطعاً عددِ حساب است، نه واریز. */
    private const val MAX_AMOUNT = 10_000_000_000L

    // کلیدواژه‌های لاتین برای تطبیق با شمارهٔ فرستنده یا متن پیامک
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
        "بلوبانک" to listOf("blubank"),
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
        "واریز", "واريز", "به حساب شما", "به حساب", "دریافت", "کارت‌به‌کارت", "کارت به کارت",
        "پایا", "ساتنا", "شتاب", "وجه به حساب", "مبلغ واریز", "واریزی", "اعتبار",
        "افزایش موجودی", "به شما", "credit"
    )

    private val debitWords = listOf(
        "برداشت", "کاهش موجودی", "خرید", "پرداخت شد", "پرداخت موفق", "انتقال به",
        "کارت شما", "کسر", "بدهکار", "شماره کارت شما", "debit"
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

    /**
     * عدد با علامت اختیاری؛ «٬» و «,» هر دو جداکنندهٔ هزارگان‌اند.
     * عمداً از خط جدید عبور نمی‌کند تا هر عدد به خط خودش نسبت داده شود.
     */
    private val amountRegex = Regex("""([+\-]?)[ \t]*([\d][\d,٬]*)""")

    /** برچسب‌هایی که یعنی عددِ بعدشان شناسه است، نه مبلغ. */
    private val labelRegex = Regex(
        "(کارت|حساب|شماره|کد|شناسه|پیگیری|رهگیری|مرجع|همراه|تلفن|موبایل|رسید|سند|device|card|ref)\\s*[:：]?\\s*$",
        RegexOption.IGNORE_CASE
    )

    private val balanceLabelRegex = Regex("(مانده|موجودی|قابل برداشت|بالانس|گردش)\\s*[:：]?\\s*$")

    // ── API ────────────────────────────────────────────────────────────────

    fun detectBank(sender: String, body: String = ""): String {
        val fromSender = sender.lowercase().replace(" ", "")
        banks.firstOrNull { (_, keys) -> keys.any { fromSender.contains(it) } }?.let { return it.first }

        val text = body.lowercase()
        // نام‌هایی که خودشان «بانک» دارند (مثل «پست بانک») مستقیم جست‌وجو می‌شوند؛ بقیه با
        // پیشوند/پسوند «بانک» تا کلمه‌های کوتاه (مثل «دی») با متن‌های دیگر اشتباه نشوند.
        banks.firstOrNull { (name, _) ->
            val n = name.lowercase()
            if (n.contains("بانک")) text.contains(n)
            else text.contains("بانک " + n) || text.contains("بانک" + n) || text.contains(n + " بانک")
        }?.let { return it.first }

        banks.firstOrNull { (_, keys) -> keys.any { text.contains(it) } }?.let { return it.first }
        return ""
    }

    fun parse(sender: String, body: String): Deposit {
        val text = normalize(body)
        val lower = text.lowercase()
        val bank = detectBank(sender, text)
        val isOtp = otpWords.any { lower.contains(it) }
        val isReversal = reversalWords.any { lower.contains(it) }
        val hasCreditWord = creditWords.any { lower.contains(it) }
        val reference = refRegex.find(text)?.groupValues?.getOrNull(1) ?: ""

        val pick = pickAmount(text, hasCreditWord)

        val reason = when {
            isOtp -> "رمز پویا/کد تأیید است"
            isReversal -> "برگشت یا تراکنش ناموفق است"
            pick.problem.isNotEmpty() -> pick.problem
            pick.rial <= 0L -> "مبلغ واریز در پیامک پیدا نشد"
            pick.rial % 10L != 0L -> "مبلغ به تومان دقیق تبدیل نمی‌شود"
            else -> ""
        }

        return Deposit(
            bank = bank.ifBlank { "بانک نامشخص" },
            amountRial = if (reason.isEmpty()) pick.rial else maxOf(pick.rial, 0L),
            reference = reference,
            eligible = reason.isEmpty(),
            reason = reason,
            source = pick.line
        )
    }

    /** برای «آزمایش تحلیل پیامک» در خود اپ: مبلغ و توضیح، بدون ارسال به سرور. */
    fun explain(sender: String, body: String): String {
        val deposit = parse(sender, body)
        val amount = if (deposit.amountRial > 0) {
            Ui.money(deposit.amountToman) + " (ریال: " + Ui.number(deposit.amountRial) + ")"
        } else {
            "—"
        }
        return buildString {
            append(if (deposit.eligible) "✅ واریز شناخته شد" else "⏭ ارسال نمی‌شود")
            append("\nمبلغ: ").append(amount)
            append("\nبانک: ").append(deposit.bank)
            if (deposit.reference.isNotBlank()) append("\nکد پیگیری: ").append(deposit.reference)
            if (deposit.reason.isNotBlank()) append("\nدلیل: ").append(deposit.reason)
            if (deposit.source.isNotBlank()) append("\nخط منبع: ").append(deposit.source)
        }
    }

    // ── انتخاب مبلغ ────────────────────────────────────────────────────────

    private fun pickAmount(text: String, hasCreditWord: Boolean): Pick {
        val masked = maskNoise(text)
        val all = candidates(masked)
        val usable = all.filter {
            !it.isBalance && !it.isLabel && it.value in MIN_AMOUNT..MAX_AMOUNT
        }

        // ۱) ساختار «+1,006,320» — همان چیزی که پست بانک می‌فرستد. اولین عدد مثبت، واریز است.
        usable.firstOrNull { it.sign == '+' }?.let { return Pick(toRial(it, masked), it.line, "") }

        // ۲) اگر تنها عددهای علامت‌دار منفی بودند، پیامک برداشت است.
        if (usable.isNotEmpty() && usable.all { it.sign == '-' }) {
            return Pick(0L, "", "پیامک برداشت است")
        }

        val positive = usable.filter { it.sign != '-' }
        if (positive.isEmpty()) return Pick(0L, "", if (hasCreditWord) "مبلغ واریز در پیامک پیدا نشد" else "پیامک واریز نیست")

        // ۳) عددی که در همان خطش کلمهٔ «واریز» هست.
        val onCreditLine = positive.filter { candidate ->
            creditWords.any { candidate.line.lowercase().contains(it) }
        }
        if (onCreditLine.size == 1) return Pick(toRial(onCreditLine[0], masked), onCreditLine[0].line, "")
        if (onCreditLine.size > 1) return Pick(0L, "", "چند مبلغ در پیامک بود و واریز مشخص نشد")

        // ۴) پیامکی که جای دیگری «واریز» دارد و فقط یک مبلغ بی‌برچسب در آن است.
        if (!hasCreditWord) return Pick(0L, "", "پیامک واریز نیست")
        if (positive.size == 1) return Pick(toRial(positive[0], masked), positive[0].line, "")
        return Pick(0L, "", "چند مبلغ در پیامک بود و واریز مشخص نشد")
    }

    /**
     * تاریخ و ساعت با فاصله جایگزین می‌شوند تا هم حذف شوند و هم جای بقیهٔ عددها به‌هم نریزد.
     * مثال: 1405/08/4 و 19:51
     */
    private fun maskNoise(text: String): String {
        var out = text
        for (regex in listOf(
            Regex("""\d{2,4}[/\-.]\d{1,2}(?:[/\-.]\d{1,4})?"""),
            Regex("""\d{1,2}:\d{2}(?::\d{2})?""")
        )) {
            out = regex.replace(out) { match -> " ".repeat(match.value.length) }
        }
        return out
    }

    private fun candidates(text: String): List<Cand> {
        val out = ArrayList<Cand>()
        for (match in amountRegex.findAll(text)) {
            val value = toNumber(match.groupValues[2])
            if (value <= 0L) continue
            val start = match.range.first
            val end = match.range.last + 1

            // خطی که خودِ عدد در آن است: برای تشخیص «واریز» و واحد پول (ریال/تومان).
            val ownStart = text.lastIndexOf('\n', start - 1).let { if (it < 0) 0 else it + 1 }
            val ownEnd = text.indexOf('\n', start).let { if (it < 0) text.length else it }
            val line = text.substring(ownStart, ownEnd).trim()

            // یک خط عقب‌تر هم نگاه می‌کنیم؛ بعضی بانک‌ها «مانده:» یا «کارت:» را
            // در خط بالا و عدد را در خط پایین می‌نویسند.
            val prevStart = if (ownStart == 0) 0 else
                text.lastIndexOf('\n', ownStart - 2).let { if (it < 0) 0 else it + 1 }
            val before = text.substring(prevStart, start)
            val after = text.substring(end, ownEnd)

            val sign = match.groupValues[1].firstOrNull() ?: ' '
            out.add(
                Cand(
                    value = value,
                    sign = sign,
                    start = start,
                    line = line,
                    before = before,
                    after = after,
                    isBalance = isBalance(before, line),
                    isLabel = labelRegex.containsMatchIn(before.lowercase())
                )
            )
        }
        return out
    }

    /** خط «مانده: …» یا «موجودی: …» هرگز واریز نیست. */
    private fun isBalance(before: String, line: String): Boolean {
        val head = line.lowercase()
        if (head.startsWith("مانده") || head.startsWith("موجودی") || head.startsWith("بالانس") ||
            head.startsWith("قابل برداشت") || head.startsWith("گردش")
        ) return true
        val b = before.lowercase()
        // «افزایش موجودی: 1,006,320» واریز است، نه مانده.
        if (b.contains("افزایش") || b.contains("کاهش")) return false
        return balanceLabelRegex.containsMatchIn(b)
    }

    /**
     * ریال‌کردن مبلغ: اول همان خط، بعد کل پیامک، و اگر هیچ واحدی نبود حدس محافظه‌کارانه
     * (عددهای ۷ رقمی به بالا ریال‌اند، کوچک‌ترها تومان).
     */
    private fun toRial(cand: Cand, text: String): Long {
        val after = cand.after.lowercase()
        val before = cand.before.lowercase()
        if (after.contains("توم")) return cand.value * 10L
        if (after.contains("ریال")) return cand.value
        if (before.contains("توم")) return cand.value * 10L
        if (before.contains("ریال")) return cand.value
        return when (nearestUnit(text, cand.start)) {
            10 -> cand.value * 10L
            1 -> cand.value
            else -> if (cand.value >= 1_000_000L) cand.value else cand.value * 10L
        }
    }

    /** واحد نزدیک‌ترین «ریال/تومان» به یک نقطه: ۱ = ریال، ۱۰ = تومان، ۰ = هیچ. */
    private fun nearestUnit(text: String, at: Int): Int {
        val rial = Regex("ریال").findAll(text).map { it.range.first }.toList()
        val toman = Regex("توم").findAll(text).map { it.range.first }.toList()
        if (rial.isEmpty() && toman.isEmpty()) return 0
        if (toman.isEmpty()) return 1
        if (rial.isEmpty()) return 10
        val dRial = rial.minOf { kotlin.math.abs(it - at) }
        val dToman = toman.minOf { kotlin.math.abs(it - at) }
        return if (dRial <= dToman) 1 else 10
    }

    private fun toNumber(raw: String): Long =
        raw.replace(",", "").replace("٬", "").replace(" ", "").toLongOrNull() ?: 0L

    /** ارقام فارسی/عربی، «ي/ك» عربی و علامت‌های منفیِ یونیکد را یکدست می‌کند؛ خط‌ها می‌مانند. */
    private fun normalize(body: String): String {
        val sb = StringBuilder(body.length)
        for (ch in body) {
            sb.append(
                when {
                    ch in '۰'..'۹' -> '0' + (ch - '۰')
                    ch in '٠'..'٩' -> '0' + (ch - '٠')
                    ch == '\u200c' || ch == '\u200e' || ch == '\u200f' -> ' '
                    ch == 'ي' -> 'ی'
                    ch == 'ك' -> 'ک'
                    ch == '−' || ch == '–' || ch == '—' -> '-'
                    ch == '\t' || ch == '\u00a0' -> ' '
                    ch == '\r' -> '\n'
                    else -> ch
                }
            )
        }
        return sb.toString()
            .replace(Regex("[ ]{2,}"), " ")
            .replace(Regex(" *\n *"), "\n")
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
    }
}
