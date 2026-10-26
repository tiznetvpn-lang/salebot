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
import android.content.res.ColorStateList
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

    private lateinit var nav: BottomNavigationView
    private var currentTab = R.id.navDashboard
    private var ordersFilter = "all"
    private var customerQuery = ""
    private var loading = false

    /** کاری که بعد از پاسخ دیالوگ سیستمی باتری اجرا می‌شود. */
    private var afterBattery: (() -> Unit)? = null

    /**
     * مسیر مجوزها: پیامک و اعلان با یک درخواست، بعد دیالوگ «اجرا در پس‌زمینه».
     * هر مرحله مستقل است؛ اگر کاربر یکی را رد کند بقیهٔ اپ سالم می‌ماند.
     */
    private val runtimePermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            val smsOk = result[Manifest.permission.RECEIVE_SMS] ?: Perms.sms(this)
            if (!smsOk) {
                prefs.smsConfirmEnabled = false
                toast("بدون اجازهٔ پیامک، تأیید خودکار واریز ممکن نیست.")
            }
            // یک‌بار پرسیدیم؛ اگر کاربر رد کرد دیگر در هر باز شدن اپ مزاحم نمی‌شویم و
            // راهنمای زرد در تب «پیامک بانکی» می‌ماند تا خودش دوباره اقدام کند.
            prefs.setupDone = true
            askBattery { if (smsOk) enableAutomation() else renderSms() }
        }

    private val batteryLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            val next = afterBattery
            afterBattery = null
            if (!Perms.battery(this)) {
                toast("اجازهٔ اجرای پس‌زمینه داده نشد؛ تأیید پیامک ممکن است با تأخیر انجام شود.")
            }
            if (next != null) next() else renderSms()
        }

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

        nav = findViewById(R.id.bottomNav)
        nav.setOnItemSelectedListener { item ->
            select(item.itemId)
            true
        }
        nav.selectedItemId = R.id.navDashboard

        // اگر نشست قبلی با سرویس روشن بسته شده، همین‌جا دوباره بالا می‌آید.
        if (prefs.guardEnabled && prefs.smsConfirmEnabled) GuardService.start(this)

        // اولین اجرا: خودِ اپ مجوز پیامک و اجرای پس‌زمینه را می‌خواهد (نه اینکه کاربر دنبالش بگردد).
        if (!prefs.setupDone) {
            window.decorView.postDelayed({
                if (!isFinishing && !prefs.setupDone) startSetup()
            }, 600)
        }
    }

    // ── مجوزها و اجرای پس‌زمینه ─────────────────────────────────────────────

    /** درخواست مجوزهای زمان‌اجرا، بعد دیالوگ معافیت باتری. */
    private fun startSetup() {
        val missing = Perms.missingRuntime(this)
        if (missing.isNotEmpty()) {
            runtimePermissions.launch(missing)
            return
        }
        askBattery { enableAutomation() }
    }

    private fun askBattery(after: () -> Unit) {
        if (Perms.battery(this)) {
            after()
            return
        }
        afterBattery = after
        try {
            batteryLauncher.launch(Perms.batteryIntent(this))
        } catch (e: Exception) {
            afterBattery = null
            after()
        }
    }

    /** همهٔ مجوزها داده شد: سوییچ روشن، سرویس بالا، Secret همگام و در پایان بررسی سلامت. */
    private fun enableAutomation() {
        if (!Perms.sms(this)) {
            prefs.smsConfirmEnabled = false
            renderSms()
            return
        }
        prefs.smsConfirmEnabled = true
        prefs.guardEnabled = true
        prefs.setupDone = true
        GuardService.start(this)
        val done: () -> Unit = {
            renderSms()
            showHealth()
        }
        if (prefs.shetabSecret.isBlank()) syncSecret(silent = true) { done() } else done()
    }

    private fun toggleGuard(on: Boolean) {
        prefs.guardEnabled = on
        if (on) {
            GuardService.start(this)
            toast("سرویس همیشه‌فعال روشن شد.")
        } else {
            GuardService.stop(this)
            toast("سرویس همیشه‌فعال خاموش شد.")
        }
        renderSms()
    }

    /** گزارش وضعیت کامل؛ همان چیزی که کاربر برای «بدون مشکل کار کند» لازم دارد. */
    private fun showHealth() {
        ui.launch {
            val rows = Perms.checklist(this@MainActivity)
            val lines = ArrayList<String>()
            for (row in rows) lines.add((if (row.ok) "✅  " else "⚠️  ") + row.title)
            lines.add((if (prefs.shetabSecret.isNotBlank()) "✅  " else "⚠️  ") + "اتصال Shetab (Secret)")
            lines.add((if (prefs.smsConfirmEnabled) "✅  " else "⚠️  ") + "سوییچ تأیید خودکار")
            if (prefs.shetabSecret.isBlank()) {
                lines.add("⚠️  سرور آزمایش نشد؛ اول Secret را همگام کنید")
            } else {
                lines.add(try {
                    val result = Api.health(prefs.baseUrl, prefs.shetabSecret)
                    if (result.status == 200 && result.json.optBoolean("success", false)) {
                        "✅  سرور جواب داد · نسخهٔ " + Ui.toFa(result.json.optString("version").ifBlank { "—" })
                    } else {
                        "⚠️  سرور کد " + result.status + " برگرداند"
                    }
                } catch (e: Exception) {
                    "⚠️  اتصال به سرور برقرار نشد"
                })
            }
            val ready = rows.all { it.ok } && prefs.smsConfirmEnabled && prefs.shetabSecret.isNotBlank()
            if (!isFinishing) {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle(if (ready) "همه‌چیز آماده است ✅" else "چند مورد مانده")
                    .setMessage(lines.joinToString("\n"))
                    .setPositiveButton("باشه", null)
                    .setNeutralButton("راهنمای پس‌زمینه") { _, _ -> showBackgroundHelp() }
                    .show()
            }
        }
    }

    /** راهنمای کوتاه مخصوص برند گوشی؛ برای MIUI/EMUI که خودکار جلوی اپ را می‌گیرند. */
    private fun showBackgroundHelp() {
        AlertDialog.Builder(this)
            .setTitle("اجرا در پس‌زمینه")
            .setMessage(
                Perms.vendorHint() +
                    "\n\nاگر این موارد انجام شود، پیامک واریز حتی وقتی اپ بسته است هم تأیید می‌شود."
            )
            .setPositiveButton("تنظیم خودکار اجرا") { _, _ -> Perms.openAutostart(this) }
            .setNegativeButton("تنظیمات باتری") { _, _ -> askBattery { renderSms() } }
            .setNeutralButton("بستن", null)
            .show()
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
                val chip = outlinedButton().apply {
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
            val reject = outlinedButton().apply {
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
        val smsOk = Perms.sms(this)

        // چک‌لیست مجوزها: هر ردیف با یک دکمه که همان درخواست سیستمی را باز می‌کند.
        val setupCard = Ui.card(this)
        val setupBox = Ui.row(this)
        setupBox.addView(Ui.text(this, "راه‌اندازی و مجوزها", 16f, R.color.tz_text, true))
        setupBox.addView(
            Ui.text(
                this,
                "تأیید خودکار واریز وقتی بی‌وقفه کار می‌کند که هر چهار مورد زیر سبز باشد. اپ خودش درخواست هر مجوز را نشان می‌دهد.",
                12f,
                R.color.tz_muted
            )
        )
        var allOk = true
        for (row in Perms.checklist(this)) {
            if (!row.ok) allOk = false
            val line = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, Ui.dp(this@MainActivity, 6), 0, 0)
            }
            line.addView(
                Ui.text(
                    this,
                    (if (row.ok) "✅  " else "⚠️  ") + row.title,
                    13f,
                    if (row.ok) R.color.tz_text else R.color.tz_warn
                ).apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                }
            )
            if (!row.ok || row.kind == Perms.KIND_GUARD) {
                line.addView(textButton().apply {
                    text = if (row.kind == Perms.KIND_GUARD) (if (row.ok) "خاموش" else "روشن") else "اجازه"
                    isAllCaps = false
                    setOnClickListener {
                        when (row.kind) {
                            Perms.KIND_SMS, Perms.KIND_NOTIFY -> startSetup()
                            Perms.KIND_BATTERY -> askBattery { renderSms() }
                            else -> toggleGuard(!row.ok)
                        }
                    }
                })
            }
            setupBox.addView(line)
        }
        setupBox.addView(Ui.gap(this, 8))
        setupBox.addView(MaterialButton(this).apply {
            text = if (allOk) "بررسی سلامت" else "راه‌اندازی کامل با یک دکمه"
            isAllCaps = false
            setOnClickListener { if (allOk) showHealth() else startSetup() }
        })
        if (!allOk) {
            setupBox.addView(outlinedButton().apply {
                text = "بررسی سلامت"
                isAllCaps = false
                setOnClickListener { showHealth() }
            })
        }
        setupBox.addView(textButton().apply {
            text = "راهنمای اجرا در پس‌زمینه"
            isAllCaps = false
            setOnClickListener { showBackgroundHelp() }
        })
        setupCard.addView(setupBox)
        smsContainer.addView(setupCard)

        // سوییچ اصلی تأیید خودکار
        val autoCard = Ui.card(this)
        val autoBox = Ui.row(this)
        val switchRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        switchRow.addView(
            Ui.text(this, "تأیید خودکار واریز", 15f, R.color.tz_text, true).apply {
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
        )
        switchRow.addView(MaterialSwitch(this).apply {
            isChecked = prefs.smsConfirmEnabled && smsOk
            setOnCheckedChangeListener { _, checked ->
                if (checked && !smsOk) {
                    startSetup()
                } else if (checked && !Perms.battery(this@MainActivity)) {
                    prefs.smsConfirmEnabled = true
                    askBattery { renderSms() }
                } else {
                    prefs.smsConfirmEnabled = checked
                    if (checked) GuardService.start(this@MainActivity) else GuardService.stop(this@MainActivity)
                    renderSms()
                }
            }
        })
        autoBox.addView(switchRow)
        autoBox.addView(
            Ui.text(
                this,
                "پیامک بانکی خوانده می‌شود، مبلغ به تومان تبدیل می‌شود و با همان قرارداد Shetab به سرور می‌رود؛ تحویل سفارش را خود ربات انجام می‌دهد.",
                12f,
                R.color.tz_muted
            )
        )
        autoCard.addView(autoBox)
        smsContainer.addView(autoCard)

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
            val test = outlinedButton().apply {
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
        head.addView(textButton().apply {
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

        // ابزار واقعی برای رفع اشکال: متن پیامک را بچسبانید و ببینید اپ چه مبلغی می‌خواند.
        smsContainer.addView(outlinedButton().apply {
            text = "آزمایش تحلیل پیامک"
            isAllCaps = false
            setOnClickListener { openSmsTester() }
        })

        smsContainer.addView(
            Ui.text(
                this,
                "سقف امن هر واریز ۵۰ میلیون تومان است. پیامک رمز پویا، برداشت و برگشت وجه ارسال نمی‌شود. هر واریز یک‌بار ارسال می‌شود.",
                11f,
                R.color.tz_muted
            )
        )
    }

    /**
     * همان تحلیلگر پیامک، روی متنی که کاربر می‌چسباند. برای اینکه بدون منتظر ماندن
     * برای یک واریز واقعی، معلوم شود کدام عدد به‌عنوان مبلغ واریز خوانده می‌شود.
     */
    private fun openSmsTester() {
        val input = EditText(this).apply {
            hint = "متن کامل پیامک بانک را اینجا بچسبانید"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            minLines = 6
            gravity = Gravity.TOP or Gravity.START
            setTextColor(ContextCompat.getColor(context, R.color.tz_text))
            setHintTextColor(ContextCompat.getColor(context, R.color.tz_muted))
            setTextDirection(View.TEXT_DIRECTION_RTL)
            setPadding(
                Ui.dp(this@MainActivity, 10), Ui.dp(this@MainActivity, 10),
                Ui.dp(this@MainActivity, 10), Ui.dp(this@MainActivity, 10)
            )
        }
        val wrap = android.widget.FrameLayout(this).apply {
            setPadding(
                Ui.dp(this@MainActivity, 14), Ui.dp(this@MainActivity, 8),
                Ui.dp(this@MainActivity, 14), 0
            )
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("آزمایش تحلیل پیامک")
            .setMessage("پیامک واریز بانک را بچسبانید؛ فقط خوانده می‌شود و چیزی به سرور نمی‌رود.")
            .setView(wrap)
            .setPositiveButton("تحلیل") { _, _ ->
                val text = input.text.toString()
                if (text.isBlank()) {
                    toast("متنی وارد نشد.")
                    return@setPositiveButton
                }
                AlertDialog.Builder(this)
                    .setTitle("نتیجهٔ تحلیل")
                    .setMessage(BankSms.explain("", text))
                    .setPositiveButton("باشه", null)
                    .show()
            }
            .setNegativeButton("انصراف", null)
            .show()
    }

    private fun syncSecret(silent: Boolean = false, onDone: (() -> Unit)? = null) {
        ui.launch {
            try {
                val data = Api.shetabApp(prefs)
                val secret = data.optString("secret")
                if (secret.isBlank()) {
                    if (!silent) toast("سرور Secret برنگرداند.")
                } else {
                    prefs.shetabSecret = secret
                    prefs.shetabEndpoint = data.optString("endpoint").ifBlank { Api.endpointFor(prefs.baseUrl) }
                    prefs.lastSecretSyncAt = System.currentTimeMillis()
                    if (!silent) toast("Secret همگام شد؛ حالا سوییچ را روشن کنید.")
                }
            } catch (e: Api.ApiError) {
                if (!silent) toast(Api.errorText(e.code))
            } catch (e: Exception) {
                if (!silent) toast("خطای شبکه: " + (e.message ?: "بدون پاسخ"))
            } finally {
                if (onDone != null) onDone() else renderSms()
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

        val perms = Ui.card(this)
        val permsBox = Ui.row(this)
        permsBox.addView(Ui.text(this, "مجوزها و اجرای پس‌زمینه", 16f, R.color.tz_text, true))
        val smsOk = Perms.sms(this)
        permsBox.addView(
            Ui.text(
                this,
                (if (smsOk) "✅ اجازهٔ پیامک داده شده" else "⚠️ اجازهٔ پیامک داده نشده") + " · " +
                    (if (Perms.battery(this)) "✅ معاف از محدودیت باتری" else "⚠️ محدودیت باتری فعال") + " · " +
                    (if (GuardService.isRunning(this)) "✅ سرویس زنده" else "⚠️ سرویس خاموش"),
                12f,
                if (smsOk) R.color.tz_muted else R.color.tz_warn
            )
        )
        permsBox.addView(MaterialButton(this).apply {
            text = "مدیریت مجوزها"
            isAllCaps = false
            setOnClickListener { nav.selectedItemId = R.id.navSms }
        })
        perms.addView(permsBox)
        settingsContainer.addView(perms)

        val logout = outlinedButton().apply {
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

    private fun outlinedButton(): MaterialButton = MaterialButton(this).apply {
        isAllCaps = false
        strokeWidth = Ui.dp(this@MainActivity, 1)
        strokeColor = ColorStateList.valueOf(ContextCompat.getColor(context, R.color.tz_stroke))
        backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(context, R.color.tz_surface_2))
        setTextColor(ContextCompat.getColor(context, R.color.tz_text))
    }

    private fun textButton(): MaterialButton = MaterialButton(this).apply {
        isAllCaps = false
        backgroundTintList = ColorStateList.valueOf(android.graphics.Color.TRANSPARENT)
        setTextColor(ContextCompat.getColor(context, R.color.tz_primary))
    }

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
        // اگر کاربر از تنظیمات سیستم برگشت، وضعیت تازه دیده شود و سرویس دوباره بالا بیاید.
        if (prefs.guardEnabled && prefs.smsConfirmEnabled && Perms.sms(this)) GuardService.start(this)
        if (currentTab == R.id.navSms && ::smsContainer.isInitialized) renderSms()
    }

    override fun onDestroy() {
        ui.cancel()
        super.onDestroy()
    }
}
