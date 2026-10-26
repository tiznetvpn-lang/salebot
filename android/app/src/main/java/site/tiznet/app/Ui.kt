package site.tiznet.app

import android.content.Context
import android.graphics.Typeface
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.card.MaterialCardView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** ابزارهای کوچک ساخت رابط؛ همه‌چیز برنامه‌نویسی‌شده تا XML و آداپتر اضافه نداشته باشیم. */
object Ui {

    fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()

    fun text(
        context: Context,
        value: String,
        sizeSp: Float,
        colorRes: Int,
        bold: Boolean = false
    ): TextView = TextView(context).apply {
        text = value
        textSize = sizeSp
        setTextColor(ContextCompat.getColor(context, colorRes))
        if (bold) typeface = Typeface.DEFAULT_BOLD
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
        setLineSpacing(dp(context, 2).toFloat(), 1f)
    }

    fun card(context: Context): MaterialCardView = MaterialCardView(context).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(context, 12) }
        setCardBackgroundColor(ContextCompat.getColor(context, R.color.tz_surface))
        strokeColor = ContextCompat.getColor(context, R.color.tz_stroke)
        strokeWidth = dp(context, 1)
        radius = dp(context, 16).toFloat()
        cardElevation = 0f
        setContentPadding(dp(context, 14), dp(context, 14), dp(context, 14), dp(context, 14))
    }

    fun row(context: Context): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
    }

    fun gap(context: Context, heightDp: Int): View = View(context).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, heightDp))
    }

    fun horizontal(context: Context): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = android.view.Gravity.CENTER_VERTICAL
    }

    fun money(value: Long): String {
        val grouped = String.format(Locale.US, "%,d", value).replace(',', '٬')
        return toFa(grouped) + " تومان"
    }

    fun number(value: Long): String = toFa(String.format(Locale.US, "%,d", value).replace(',', '٬'))

    fun toFa(input: String): String =
        input.map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")

    fun dateTime(ts: Long): String {
        if (ts <= 0) return "—"
        val format = SimpleDateFormat("MM/dd HH:mm", Locale.US)
        return toFa(format.format(Date(ts)))
    }
}
