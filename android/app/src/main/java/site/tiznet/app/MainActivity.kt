package site.tiznet.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.materialswitch.MaterialSwitch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * تنها صفحهٔ اصلی اپ: پنج تب روی همان API مینی‌اپ/ربات. هیچ داده‌ای محلی نگه داشته
 * نمی‌شود؛ هر بار که چیزی تغییر می‌کند، سرور را دوباره می‌خوانیم تا چت، مینی‌اپ و اپ
 * همیشه یک عدد را نشان دهند.
 */
class MainActivity : AppCompatActivity() {

    private val ui = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var app: App
    private lateinit var prefs: Prefs

    private lateinit var dashboardPage: View
    private lateinit var ordersPage: View
    private lateinit var customersPage: View
    private lateinit var smsPage: View
    private lateinit var settingsPage: View

    private lateinit var dashboardContainer: LinearLayout
    private lateinit var ordersContainer: LinearLayout
    private lateinit var customersContainer: LinearLayout
    private lateinit var smsContainer: LinearLayout
    private lateinit var settingsContainer: LinearLayout
    private lateinit var headerTitle: TextView
    private lateinit var headerSub: TextView

    private var currentTab = R.id.navDashboard
    private var ordersFilter = "all"
    private var customerQuery = ""
    private var loading = false

    private val smsPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            toast("اجازهٔ خواندن پیامک داده شد.")
        } else {
            toast("بدون اجازهٔ پیامک، تأیید خودکار واریز کار نمی‌کند.")
            prefs.smsConfirmEnabled = false
        }
        renderSms()
    }

    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        app = application as App
        prefs = app.prefs

        if (prefs.cookie.isBlank()) {
            goLogin()
            return
        }

        dashboardPage = findViewById(R.id.dashboardPage)
        ordersPage = findViewById(R.id.ordersPage)
        customersPage = findViewById(R.id.customersPage)
        smsPage = findViewById(R.id.smsPage)
        settingsPage = findViewById(R.id.settingsPage)
        dashboardContainer = findViewById(R.id.dashboardContainer)
        ordersContainer = findViewById(R.id.ordersContainer)
        customersContainer = findViewById(R.id.customersContainer)
        smsContainer = findViewById(R.id.smsContainer)
        settingsContainer = findViewById(R.id.settingsContainer)
        headerTitle = findViewById(R.id.headerTitle)
        headerSub = findViewById(R.id.headerSub)

        findViewById<MaterialButton>(R.id.refreshButton).setOnClickListener { refreshCurrent() }

        val nav = findViewById<BottomNavigationView>(R.id.bottomNav)
        nav.setOnItemSelectedListener { item ->
            select(item.itemId)
            true
        }
        nav.selectedItemId = R.id.navDashboard

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    // ── ناوبری ─────────────────────────────────────────────────────────────

    private fun select(id: Int) {
        currentTab = id
        dashboardPage.visibility = if (id == R.id.navDashboard) View.VISIBLE else View.GONE
        ordersPage.visibility = if (id == R.id.navOrders) View.VISIBLE else View.GONE
        customersPage.visibility = if (id == R.id.navCustomers) View.VISIBLE else View.GONE
        smsPage.visibility = if (id == R.id.navSms) View.VISIBLE else View.GONE
        settingsPage.visibility = if (id == R.id.navSettings) View.VISIBLE else View.GONE
        when (id) {
            R.id.navDashboard -> { headerTitle.text = "نمای کلی"; loadDashboard() }
            R.id.navOrders -> { headerTitle.text = "سفارش‌ها"; loadOrders() }
            R.id.navCustomers -> { headerTitle.text = "مشتری‌ها"; loadCustomers() }
            R.id.navSms -> { headerTitle.text = "پیامک بانکی"; renderSms() }
            R.id.navSettings -> { headerTitle.text = "تنظیمات"; renderSettings() }
        }
    }

    private fun refreshCurrent() {
        if (loading) return
        when (currentTab) {
            R.id.navOrders -> loadOrders()
            R.id.navCustomers -> loadCustomers(force = true)
            R.id.navSms -> renderSms()
            R.id.navSettings -> renderSettings()
            else -> loadDashboard()
        }
    }

    // ── داشبورد ────────────────────────────────────────────────────────────

    private fun loadDashboard() {
        if (loading) return
        loading = true
        ui.launch {
            try {
                val boot = Api.bootstrap(prefs)
                prefs.role = boot.optString("role")
                val profile = boot.optJSONObject("profile")
                val name = profile?.optString("first_name").orEmpty().ifBlank {
                    profile?.optString("username").orEmpty()
                }
                prefs.accountName = name
                prefs.accountId = profile?.optString("id").orEmpty()
                headerSub.text = "نسخهٔ سرور " + Ui.toFa(boot.optString("version").ifBlank { "—" })

                val summary = Api.summary(prefs, 30)
                renderDashboard(summary, name, boot.optString("version", ""))
            } catch (e: Exception) {
                showError(dashboardContainer, e)
            } finally {
                loading = false
            }
        }
    }

    private fun renderDashboard(summary: JSONObject, name: String, version: String) {
        dashboardContainer.removeAllViews()
        val totals = summary.optJSONObject("totals") ?: JSONObject()

        dashboardContainer.addView(
            Ui.text(this, "سلام " + name.ifBlank { "مدیر" } + " 👋", 18f, R.color.tz_text, true)
        )
        dashboardContainer.addView(
            Ui.text(this, "گزارش ۳۰ روز اخیر · نسخهٔ " + Ui.toFa(version.ifBlank { "—" }), 12f, R.color.tz_muted)
        )
        dashboardContainer.addView(Ui.gap(this, 12))

        val grid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        grid.addView(kpiRow(
            listOf(
                "درآمد" to Ui.money(totals.optLong("revenue")),
                "فروش موفق" to Ui.number(totals.optLong("sales"))
            )
        ))
        grid.addView(Ui.gap(this, 10))
        grid.addView(kpiRow(
            listOf(
                "سفارش در انتظار" to Ui.number(totals.optLong("pending_orders")),
                "کاربران" to Ui.number(totals.optLong("users"))
            )
        ))
        grid.addView(Ui.gap(this, 10))
        grid.addView(kpiRow(
            listOf(
                "خرید جدید" to Ui.number(totals.optLong("new_sales")),
                "تمدید" to Ui.number(totals.optLong("renewals"))
            )
        ))
        dashboardContainer.addView(grid)
        dashboardContainer.addView(Ui.gap(this, 16))

        val recent = summary.optJSONArray("recent_orders") ?: JSONArray()
        dashboardContainer.addView(Ui.text(this, "آخرین سفارش‌ها", 16f, R.color.tz_text, true))
        dashboardContainer.addView(Ui.gap(this, 8))
        if (recent.length() == 0) {
            dashboardContainer.addView(Ui.text(this, "سفارشی در این بازه نیست.", 13f, R.color.tz_muted))
        } else {
            for (i in 0 until minOf(recent.length(), 6)) {
                val row = recent.optJSONObject(i) ?: continue
                dashboardContainer.addView(orderCard(row, compact = true))
            }
        }

        val pending = totals.optLong("pending_orders")
        if (pending > 0) {
            dashboardContainer.addView(Ui.gap(this, 6))
            val button = MaterialButton(this).apply {
                text = "بررسی " + Ui.number(pending) + " سفارش در انتظار"
                setOnClickListener {
                    findViewById<BottomNavigationView>(R.id.bottomNav).selectedItemId = R.id.navOrders
                    ordersFilter = "pending"
                }
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            }
            dashboardContainer.addView(button)
        }
    }

    private fun kpiRow(items: List<Pair<String, String>>): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            weightSum = 2f
        }
        for ((label, value) in items) {
            val card = Ui.card(this)
            val params = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            params.marginEnd = Ui.dp(this, 6)
            card.layoutParams = params
            val box = Ui.row(this)
            box.addView(Ui.text(this, label, 12f, R.color.tz_muted))
            box.addView(Ui.text(this, value, 17f, R.color.tz_text, true))
            card.addView(box)
            row.addView(card)
        }
        return row
    }

    // ── سفارش‌ها ───────────────────────────────────────────────────────────

    private fun loadOrders() {
        if (loading) return
        loading = true
        ui.launch {
            try {
                val data = Api.orders(prefs, status = ordersFilter, limit = 30)
                renderOrders(data)
            } catch (e: Exception) {
                showError(ordersContainer, e)
            } finally {
                loading = false
            }
        }
    }

    private fun renderOrders(data: JSONObject) {
        ordersContainer.removeAllViews()

        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("همه" to "all", "در انتظار" to "pending", "تکمیل‌شده" to "approved", "ردشده" to "rejected")
            .forEach { (label, value) ->
                val chip = MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                    text = label
                    isAllCaps = false
                    textSize = 12f
                    if (ordersFilter == value) {
                        setBackgroundColor(ContextCompat.getColor(context, R.color.tz_primary_dark))
                    }
                    setOnClickListener {
                        if (ordersFilter != value) {
                            ordersFilter = value
                            loadOrders()
                        }
                    }
                    layoutParams = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { marginEnd = Ui.dp(context, 6) }
                }
                tabs.addView(chip)
            }
        ordersContainer.addView(tabs)
        ordersContainer.addView(Ui.gap(this, 12))

        val rows = data.optJSONArray("items") ?: data.optJSONArray("orders") ?: JSONArray()
        val total = data.optInt("total", data.optInt("matched", rows.length()))
        ordersContainer.addView(
            Ui.text(this, Ui.number(total.toLong()) + " سفارش در این فهرست", 12f, R.color.tz_muted)
        )
        ordersContainer.addView(Ui.gap(this, 8))
        if (rows.length() == 0) {
            ordersContainer.addView(Ui.text(this, "سفارشی با این فیلتر نیست.", 13f, R.color.tz_muted))
            return
        }
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            ordersContainer.addView(orderCard(row, compact = false))
        }
    }

    private fun orderCard(row: JSONObject, compact: Boolean): View {
        val card = Ui.card(this)
        val box = Ui.row(this)
        val id = row.optString("id")
        val status = row.optString("state").ifBlank { row.optString("status") }
        val amount = row.optLong("amount")

        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        head.addView(Ui.text(this, "سفارش " + id, 15f, R.color.tz_text, true).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        head.addView(Ui.text(this, statusLabel(status), 12f, statusColor(status), true))
        box.addView(head)

        box.addView(Ui.text(this, row.optString("name").ifBlank { "—" }, 13f, R.color.tz_muted))
        val plan = row.optString("plan")
        val method = row.optString("method")
        if (plan.isNotBlank() || method.isNotBlank()) {
            box.addView(Ui.text(this, listOf(plan, method).filter { it.isNotBlank() }.joinToString(" · "), 12f, R.color.tz_muted))
        }
        box.addView(Ui.text(this, Ui.money(amount) + " · " + Ui.dateTime(row.optLong("created_at")), 13f, R.color.tz_text))

        if (!compact && status == "pending") {
            val actions = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, Ui.dp(this@MainActivity, 8), 0, 0)
            }
            val approve = MaterialButton(this).apply {
                text = "تأیید"
                isAllCaps = false
                setOnClickListener { approveOrder(id, false) }
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    .apply { marginEnd = Ui.dp(context, 6) }
            }
            val reject = MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = "رد"
                isAllCaps = false
                setOnClickListener { rejectOrder(id) }
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            actions.addView(approve)
            actions.addView(reject)
            box.addView(actions)
        }
        card.addView(box)
        return card
    }

    private fun statusLabel(status: String): String = when (status) {
        "pending" -> "در انتظار"
        "approved" -> "تکمیل‌شده"
        "rejected" -> "ردشده"
        "cancelled" -> "لغوشده"
        else -> status.ifBlank { "—" }
    }

    private fun statusColor(status: String): Int = when (status) {
        "approved" -> R.color.tz_ok
        "rejected", "cancelled" -> R.color.tz_warn
        else -> R.color.tz_primary
    }

    private fun approveOrder(id: String, manual: Boolean) {
        ui.launch {
            try {
                if (manual) {
                    Api.orderAction(prefs, id, "approve_manual", paymentReceivedConfirmed = true)
                } else {
                    Api.orderAction(prefs, id, "approve")
                }
                toast("سفارش $id تأیید شد.")
                loadOrders()
            } catch (e: Api.ApiError) {
                if (e.code == "payment_not_verified" && !manual) {
                    confirmManualApproval(id)
                } else {
                    toast(Api.errorText(e.code))
                }
            } catch (e: Exception) {
                toast("خطای شبکه: " + (e.message ?: "بدون پاسخ"))
            }
        }
    }

    private fun confirmManualApproval(id: String) {
        AlertDialog.Builder(this)
            .setTitle("تأیید دستی پرداخت")
            .setMessage("پرداخت سفارش $id در ربات تأیید نشده است. اگر مبلغ را در حساب خود دیده‌اید، تأیید دستی ثبت می‌شود و نام شما در سفارش می‌ماند.")
            .setPositiveButton("تأیید دستی") { _, _ ->
                ui.launch {
                    try {
                        Api.orderAction(prefs, id, "approve_manual", paymentReceivedConfirmed = true)
                        toast("سفارش $id با تأیید دستی ثبت شد.")
                        loadOrders()
                    } catch (e: Api.ApiError) {
                        toast(Api.errorText(e.code))
                    } catch (e: Exception) {
                        toast("خطای شبکه: " + (e.message ?: "بدون پاسخ"))
                    }
                }
            }
            .setNegativeButton("انصراف", null)
            .show()
    }

    private fun rejectOrder(id: String) {
        val input = EditText(this).apply {
            hint = "دلیل رد (اختیاری)"
            inputType = InputType.TYPE_CLASS_TEXT
            setTextColor(ContextCompat.getColor(context, R.color.tz_text))
        }
        AlertDialog.Builder(this)
            .setTitle("رد سفارش $id")
            .setView(input)
            .setPositiveButton("رد سفارش") { _, _ ->
                ui.launch {
                    try {
                        Api.orderAction(prefs, id, "reject", input.text.toString())
                        toast("سفارش $id رد شد.")
                        loadOrders()
                    } catch (e: Api.ApiError) {
                        toast(Api.errorText(e.code))
                    } catch (e: Exception) {
                        toast("خطای شبکه: " + (e.message ?: "بدون پاسخ"))
                    }
                }
            }
            .setNegativeButton("انصراف", null)
            .show()
    }

    // ── مشتری‌ها ───────────────────────────────────────────────────────────

    private fun loadCustomers(force: Boolean = false) {
        if (loading && !force) return
        loading = true
        ui.launch {
            try {
                val data = Api.customers(prefs, customerQuery, 40)
                renderCustomers(data)
            } catch (e: Exception) {
                showError(customersContainer, e)
            } finally {
                loading = false
            }
        }
    }

    private fun renderCustomers(data: JSONObject) {
        customersContainer.removeAllViews()
        val search = EditText(this).apply {
            hint = "جست‌وجوی نام، یوزرنیم یا شناسهٔ عددی"
            setText(customerQuery)
            setTextColor(ContextCompat.getColor(context, R.color.tz_text))
            setSingleLine()
        }
        customersContainer.addView(search)
        val searchButton = MaterialButton(this).apply {
            text = "جست‌وجو"
            isAllCaps = false
            setOnClickListener {
                customerQuery = search.text.toString().trim()
                loadCustomers(force = true)
            }
        }
        customersContainer.addView(searchButton)
        customersContainer.addView(Ui.gap(this, 10))

        val rows = data.optJSONArray("items") ?: data.optJSONArray("customers") ?: JSONArray()
        val total = data.optInt("total", data.optInt("matched", rows.length()))
        customersContainer.addView(
            Ui.text(this, Ui.number(total.toLong()) + " مشتری", 12f, R.color.tz_muted)
        )
        customersContainer.addView(Ui.gap(this, 8))
        if (rows.length() == 0) {
            customersContainer.addView(Ui.text(this, "مشتری‌ای با این جست‌وجو پیدا نشد.", 13f, R.color.tz_muted))
            return
        }
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            val card = Ui.card(this)
            val box = Ui.row(this)
            val name = row.optString("first_name").ifBlank { "کاربر " + row.optString("tg_id") }
            box.addView(Ui.text(this, name, 15f, R.color.tz_text, true))
            val handle = row.optString("username")
            box.addView(
                Ui.text(
                    this,
                    (if (handle.isNotBlank()) "@$handle · " else "") + "شناسه " + Ui.toFa(row.optString("tg_id")),
                    11f,
                    R.color.tz_muted
                )
            )
            val active = row.optInt("active_subscriptions")
            val totalSubs = row.optInt("subscriptions")
            val balance = row.optLong("balance")
            box.addView(
                Ui.text(
                    this,
                    "اشتراک فعال " + Ui.number(active.toLong()) + " از " + Ui.number(totalSubs.toLong()) +
                        " · موجودی " + Ui.money(balance),
                    12f,
                    R.color.tz_muted
                )
            )
            card.addView(box)
            customersContainer.addView(card)
        }
    }

    // ── پیامک بانکی ────────────────────────────────────────────────────────

    private fun renderSms() {
        smsContainer.removeAllViews()
        val hasPermission = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) ==
            PackageManager.PERMISSION_GRANTED

        val statusCard = Ui.card(this)
        val statusBox = Ui.row(this)
        statusBox.addView(Ui.text(this, "تأیید خودکار واریز", 16f, R.color.tz_text, true))
        statusBox.addView(
            Ui.text(
                this,
                "پیامک بانکی خوانده می‌شود، مبلغ به تومان تبدیل می‌شود و با همان قرارداد Shetab به سرور می‌رود؛ تحویل سفارش را خود ربات انجام می‌دهد.",
                12f,
                R.color.tz_muted
            )
        )
        val switchRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, Ui.dp(this@MainActivity, 8), 0, 0)
        }
        switchRow.addView(Ui.text(this, if (hasPermission) "فعال" else "بدون اجازهٔ پیامک", 13f, R.color.tz_text).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        val toggle = MaterialSwitch(this).apply {
            isChecked = prefs.smsConfirmEnabled && hasPermission
            setOnCheckedChangeListener { _, checked ->
                if (checked && !hasPermission) {
                    smsPermission.launch(Manifest.permission.RECEIVE_SMS)
                } else {
                    prefs.smsConfirmEnabled = checked
                }
            }
        }
        switchRow.addView(toggle)
        statusBox.addView(switchRow)

        if (!hasPermission) {
            val grant = MaterialButton(this).apply {
                text = "دادن اجازهٔ خواندن پیامک"
                isAllCaps = false
                setOnClickListener { smsPermission.launch(Manifest.permission.RECEIVE_SMS) }
            }
            statusBox.addView(grant)
        }
        statusCard.addView(statusBox)
        smsContainer.addView(statusCard)

        val syncCard = Ui.card(this)
        val syncBox = Ui.row(this)
        syncBox.addView(Ui.text(this, "اتصال به سرور", 16f, R.color.tz_text, true))
        val secretSet = prefs.shetabSecret.isNotBlank()
        syncBox.addView(
            Ui.text(
                this,
                if (secretSet) "Secret همگام شده ✅ · " + Ui.toFa(prefs.shetabEndpoint)
                else "Secret هنوز از سرور گرفته نشده ❌",
                12f,
                if (secretSet) R.color.tz_muted else R.color.tz_warn
            )
        )
        val syncButton = MaterialButton(this).apply {
            text = if (secretSet) "همگام‌سازی دوباره" else "گرفتن Secret از سرور"
            isAllCaps = false
            setOnClickListener { syncSecret() }
        }
        syncBox.addView(syncButton)
        if (secretSet) {
            val test = MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = "آزمایش اتصال"
                isAllCaps = false
                setOnClickListener { testConnection() }
            }
            syncBox.addView(test)
        }
        syncCard.addView(syncBox)
        smsContainer.addView(syncCard)

        val logCard = Ui.card(this)
        val logBox = Ui.row(this)
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        head.addView(Ui.text(this, "آخرین واریزها", 16f, R.color.tz_text, true).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        head.addView(MaterialButton(this, null, com.google.android.material.R.attr.materialButtonTextButtonStyle).apply {
            text = "پاک‌کردن"
            isAllCaps = false
            setOnClickListener {
                prefs.clearLogs()
                renderSms()
            }
        })
        logBox.addView(head)
        val logs = prefs.logs()
        if (logs.isEmpty()) {
            logBox.addView(Ui.text(this, "هنوز واریزی خوانده نشده است.", 12f, R.color.tz_muted))
        } else {
            for ((at, line) in logs.take(12)) {
                logBox.addView(Ui.text(this, Ui.dateTime(at) + " · " + line, 12f, R.color.tz_text))
            }
        }
        logCard.addView(logBox)
        smsContainer.addView(logCard)

        smsContainer.addView(
            Ui.text(
                this,
                "سقف امن هر واریز ۵۰ میلیون تومان است. پیامک رمز پویا، برداشت و برگشت وجه ارسال نمی‌شود. هر واریز یک‌بار ارسال می‌شود.",
                11f,
                R.color.tz_muted
            )
        )
    }

    private fun syncSecret() {
        ui.launch {
            try {
                val data = Api.shetabApp(prefs)
                val secret = data.optString("secret")
                if (secret.isBlank()) {
                    toast("سرور Secret برنگرداند.")
                    return@launch
                }
                prefs.shetabSecret = secret
                prefs.shetabEndpoint = data.optString("endpoint").ifBlank { Api.endpointFor(prefs.baseUrl) }
                prefs.lastSecretSyncAt = System.currentTimeMillis()
                toast("Secret همگام شد؛ حالا سوییچ را روشن کنید.")
                renderSms()
            } catch (e: Api.ApiError) {
                toast(Api.errorText(e.code))
            } catch (e: Exception) {
                toast("خطای شبکه: " + (e.message ?: "بدون پاسخ"))
            }
        }
    }

    private fun testConnection() {
        ui.launch {
            try {
                val result = Api.health(prefs.baseUrl, prefs.shetabSecret)
                val ok = result.status == 200 && result.json.optBoolean("success", false)
                val version = result.json.optString("version")
                toast(if (ok) "اتصال سالم است · نسخهٔ " + Ui.toFa(version) else "سرور اتصال را رد کرد (" + result.status + ")")
            } catch (e: Exception) {
                toast("اتصال برقرار نشد: " + (e.message ?: "خطای شبکه"))
            }
        }
    }

    // ── تنظیمات ────────────────────────────────────────────────────────────

    private fun renderSettings() {
        settingsContainer.removeAllViews()

        val account = Ui.card(this)
        val box = Ui.row(this)
        box.addView(Ui.text(this, "حساب", 16f, R.color.tz_text, true))
        box.addView(Ui.text(this, prefs.accountName.ifBlank { "مدیر" }, 14f, R.color.tz_text))
        box.addView(Ui.text(this, "شناسهٔ تلگرام " + Ui.toFa(prefs.accountId.ifBlank { "—" }), 12f, R.color.tz_muted))
        box.addView(Ui.text(this, "سرور: " + prefs.baseUrl, 12f, R.color.tz_muted))
        account.addView(box)
        settingsContainer.addView(account)

        val about = Ui.card(this)
        val aboutBox = Ui.row(this)
        aboutBox.addView(Ui.text(this, "دربارهٔ اپ", 16f, R.color.tz_text, true))
        aboutBox.addView(Ui.text(this, "تیزنت · نسخهٔ " + BuildConfig.VERSION_NAME, 13f, R.color.tz_text))
        aboutBox.addView(
            Ui.text(
                this,
                "این اپ داده‌ای روی گوشی نگه نمی‌دارد؛ همهٔ فهرست‌ها را از همان API مینی‌اپ می‌خواند و برای تأیید واریز از همان قرارداد Shetab استفاده می‌کند.",
                12f,
                R.color.tz_muted
            )
        )
        about.addView(aboutBox)
        settingsContainer.addView(about)

        val logout = MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = "خروج از حساب"
            isAllCaps = false
            setOnClickListener { confirmLogout() }
        }
        settingsContainer.addView(logout)
    }

    private fun confirmLogout() {
        AlertDialog.Builder(this)
            .setTitle("خروج")
            .setMessage("نشست این گوشی پاک می‌شود. تنظیمات پیامک بانکی و Secret سرور می‌ماند.")
            .setPositiveButton("خروج") { _, _ ->
                ui.launch {
                    Api.logout(prefs.baseUrl, prefs.cookie)
                    prefs.clearSession()
                    goLogin()
                }
            }
            .setNegativeButton("انصراف", null)
            .show()
    }

    // ── کمکی‌ها ────────────────────────────────────────────────────────────

    private fun showError(container: LinearLayout, e: Exception) {
        container.removeAllViews()
        if (e is Api.ApiError && e.code == "unauthorized") {
            goLogin()
            return
        }
        val message = when (e) {
            is Api.ApiError -> Api.errorText(e.code)
            else -> "اتصال به سرور برقرار نشد: " + (e.message ?: "خطای شبکه")
        }
        container.addView(Ui.text(this, message, 14f, R.color.tz_warn))
        container.addView(Ui.gap(this, 10))
        container.addView(MaterialButton(this).apply {
            text = "تلاش دوباره"
            isAllCaps = false
            setOnClickListener { refreshCurrent() }
        })
    }

    private fun goLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    override fun onResume() {
        super.onResume()
        if (currentTab == R.id.navSms && ::smsContainer.isInitialized) renderSms()
    }

    override fun onDestroy() {
        ui.cancel()
        super.onDestroy()
    }
}
