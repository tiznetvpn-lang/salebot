package site.tiznet.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * تست‌های JVM روی تحلیل پیامک بانکی. همین‌ها در GitHub Actions قبل از ساخت APK اجرا
 * می‌شوند تا اگر روزی قاعدهٔ مبلغ خراب شد، APK منتشر نشود.
 *
 * مهم‌ترین کیس، پیامک واقعی پست بانک است: مبلغ واریز «+1,006,320» است و «مانده: 7,425,882»
 * نباید هیچ‌وقت انتخاب شود (باگ نسخهٔ 1.1.0).
 */
class BankSmsTest {

    private val postBank = """
        پست بانک

        واريز به کارت: 2972

        +1,006,320

        1405/08/4

        19:51

        مانده: 7,425,882 ريال
    """.trimIndent()

    @Test
    fun postBankDepositIsThePlusAmountNotTheBalance() {
        val d = BankSms.parse("+9830001234", postBank)
        assertTrue("پیامک باید واریز شناخته شود: " + d.reason, d.eligible)
        assertEquals(1_006_320L, d.amountRial)
        assertEquals(100_632L, d.amountToman)
        // ماندهٔ حساب باگ نسخهٔ قبل بود؛ هرگز نباید برگردد.
        assertNotEquals(742_588L, d.amountToman)
        assertEquals("پست بانک", d.bank)
        assertTrue("خط منبع باید همان خط + باشد: " + d.source, d.source.contains("1,006,320") && d.source.contains("+"))
    }

    @Test
    fun persianDigitsWorkToo() {
        val sms = "پست بانک\nواريز به کارت: ۲۹۷۲\n+۱٬۰۰۶٬۳۲۰\n۱۴۰۵/۰۸/۴\n۱۹:۵۱\nمانده: ۷٬۴۲۵٬۸۸۲ ریال"
        val d = BankSms.parse("+9830001234", sms)
        assertTrue(d.reason, d.eligible)
        assertEquals(1_006_320L, d.amountRial)
        assertEquals(100_632L, d.amountToman)
    }

    @Test
    fun tomanAmountIsConvertedToRial() {
        val sms = "بانک ملت\nواریز به حساب شما: 250,000 تومان\nمانده: 3,000,000 ریال"
        val d = BankSms.parse("+9821000000", sms)
        assertTrue(d.reason, d.eligible)
        assertEquals(2_500_000L, d.amountRial)
        assertEquals(250_000L, d.amountToman)
    }

    @Test
    fun balanceLineIsNeverPickedWhenAmountMovesToNextLine() {
        val sms = "بانک سامان\nواریز به حساب شما\n1,006,320 ریال\nمانده: 7,425,882 ریال"
        val d = BankSms.parse("+9821000000", sms)
        assertTrue(d.reason, d.eligible)
        assertEquals(1_006_320L, d.amountRial)
    }

    @Test
    fun balanceLabelOnThePreviousLineIsStillIgnored() {
        val sms = "بانک ملی\nواریز به حساب شما: 1,006,320 ریال\nمانده:\n7,425,882 ریال"
        val d = BankSms.parse("+9821000000", sms)
        assertTrue(d.reason, d.eligible)
        assertEquals(1_006_320L, d.amountRial)
        assertEquals(100_632L, d.amountToman)
    }

    @Test
    fun postBankWithoutCardLineStillPicksThePlusAmount() {
        val sms = "پست بانک\n+۱٬۰۰۶٬۳۲۰\nمانده: ۷٬۴۲۵٬۸۸۲ ريال"
        val d = BankSms.parse("POSTBANK", sms)
        assertTrue(d.reason, d.eligible)
        assertEquals(100_632L, d.amountToman)
    }

    @Test
    fun withdrawalIsRejected() {
        val sms = "بانک صادرات\nبرداشت از کارت: 1234\n-1,000,000\n\nمانده: 5,000,000 ریال"
        val d = BankSms.parse("+9821000000", sms)
        assertFalse(d.eligible)
        assertEquals(0L, d.amountRial)
    }

    @Test
    fun otpIsRejected() {
        val d = BankSms.parse("+9821000000", "کد تایید شما: 123456")
        assertFalse(d.eligible)
        assertTrue(d.reason.contains("رمز"))
    }

    @Test
    fun twoUnknownAmountsAreNotGuessed() {
        val sms = "بانک تجارت\nواریز\n1,000,000\n2,000,000\nمانده: 5,000,000 ریال"
        val d = BankSms.parse("+9821000000", sms)
        assertFalse("مبلغ مبهم نباید حدس زده شود", d.eligible)
    }

    @Test
    fun cardNumberTailIsNotTreatedAsAmount() {
        val d = BankSms.parse("+9830001234", postBank)
        assertNotEquals(2972L, d.amountRial)
        assertNotEquals(2_972L, d.amountToman)
    }

    @Test
    fun bankNameIsDetectedFromMessageBody() {
        assertEquals("پست بانک", BankSms.detectBank("+9830001234", postBank))
        assertEquals("ملت", BankSms.detectBank("+9821000000", "بانک ملت\nواریز 100,000 تومان"))
        assertEquals("دی", BankSms.detectBank("+9821000000", "بانک دی\nواریز 100,000 تومان"))
        // کلمهٔ «دیروز» نباید بانک «دی» شناخته شود.
        assertEquals("", BankSms.detectBank("+9821000000", "دیروز واریزی نداشتید"))
    }
}
