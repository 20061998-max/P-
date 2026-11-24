package com.telacast.mirror.ui

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.telacast.mirror.BuildConfig
import com.telacast.mirror.data.AppUpdateManager
import com.telacast.mirror.data.OfflineLicenseManager
import com.telacast.mirror.databinding.ActivityMainBinding
import com.telacast.mirror.service.FloatingBroadcastService
import com.telacast.mirror.service.ScreenMirrorService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_USER_NAME = "extra_user_name"
        const val EXTRA_PLAN_NAME = "extra_plan_name"
        const val EXTRA_AUTH_MODE = "extra_auth_mode"
        const val EXTRA_AUTH_TOKEN = "extra_auth_token"
    }

    private data class NativeAppItem(
        val label: String,
        val packageName: String?,
        val fallbackUrl: String? = null
    )

    private val priorityPackages = listOf(
        "com.flamengo.flatv",
        "com.globo.premierefc",
        "com.globo.globotv",
        "com.google.android.youtube",
        "com.disney.disneyplus",
        "com.cbs.ca",
        "com.nst.iptvsmarterstvbox",
        "com.android.chrome"
    )

    private var allInstalledApps: List<NativeAppItem> = emptyList()
    private var displayedApps: List<NativeAppItem> = emptyList()

    private lateinit var binding: ActivityMainBinding
    private lateinit var projectionManager: MediaProjectionManager
    private var isStreaming = false
    private var pendingLaunchAfterStart = false
    private var pendingDirectScreen = true
    private var authMode: String = "offline"
    private var authToken: String = ""
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            atualizarEstadoUi(ScreenMirrorService.isRunning)
        }
    }

    private val requestRuntimePermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ -> }

    private val overlayPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
                iniciarBotaoFlutuante()
            } else {
                Toast.makeText(
                    this,
                    "Autorize 'Sobrepor a outros apps' para exibir o botão flutuante INICIAR TRANSMISSÃO em qualquer app.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }

    private val screenCaptureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK && result.data != null) {
                val prefs = getSharedPreferences(ScreenMirrorService.PREFS_BROADCASTER, Context.MODE_PRIVATE)
                val selected = getSelectedNativeApp()
                val sourceLabel = if (pendingDirectScreen) {
                    "Tela Direta do Celular"
                } else {
                    selected?.label ?: "App Nativo"
                }

                prefs.edit()
                    .putString(ScreenMirrorService.KEY_SOURCE_APP, sourceLabel)
                    .putString(
                        ScreenMirrorService.KEY_TARGET_PACKAGE,
                        if (pendingDirectScreen) "" else selected?.packageName.orEmpty()
                    )
                    .apply()

                val serviceIntent = Intent(this, ScreenMirrorService::class.java).apply {
                    action = ScreenMirrorService.ACTION_START
                    putExtra(ScreenMirrorService.EXTRA_RESULT_CODE, result.resultCode)
                    putExtra(ScreenMirrorService.EXTRA_RESULT_DATA, result.data)
                    putExtra(
                        ScreenMirrorService.EXTRA_SERVER_URL,
                        prefs.getString(ScreenMirrorService.KEY_SERVER_URL, BuildConfig.API_BASE_URL)
                    )
                    putExtra(
                        ScreenMirrorService.EXTRA_ADMIN_TOKEN,
                        prefs.getString(ScreenMirrorService.KEY_ADMIN_TOKEN, "")
                    )
                    putExtra(
                        ScreenMirrorService.EXTRA_BROADCAST_TITLE,
                        prefs.getString(ScreenMirrorService.KEY_BROADCAST_TITLE, "Jogos do Mengão · Ao Vivo")
                    )
                    putExtra(ScreenMirrorService.EXTRA_SOURCE_APP, sourceLabel)
                }
                ContextCompat.startForegroundService(this, serviceIntent)
                atualizarEstadoUi(ativo = true)

                if (pendingLaunchAfterStart) {
                    pendingLaunchAfterStart = false
                    abrirAppNativoSelecionado()
                }
            } else {
                pendingLaunchAfterStart = false
                Toast.makeText(this, "Permissão de captura negada.", Toast.LENGTH_SHORT).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        projectionManager =
            getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

        authMode = intent.getStringExtra(EXTRA_AUTH_MODE) ?: "offline"
        authToken = intent.getStringExtra(EXTRA_AUTH_TOKEN) ?: ""
        if (authMode == "online" && authToken.isNotBlank()) {
            val prefs = getSharedPreferences(ScreenMirrorService.PREFS_BROADCASTER, Context.MODE_PRIVATE)
            val savedServer = prefs.getString(ScreenMirrorService.KEY_SERVER_URL, null)?.trim()
            prefs.edit().apply {
                putString(ScreenMirrorService.KEY_ADMIN_TOKEN, authToken)
                if (savedServer.isNullOrBlank()) {
                    putString(ScreenMirrorService.KEY_SERVER_URL, BuildConfig.API_BASE_URL.trim())
                }
                apply()
            }
        }
        val nome = intent.getStringExtra(EXTRA_USER_NAME) ?: "Admin Transmissor"
        val plano = intent.getStringExtra(EXTRA_PLAN_NAME) ?: "Modo Transmissão"
        binding.txtAssinante.text = "$nome · $plano"

        solicitarPermissoesIniciais()
        carregarAppsNativosInstalados()
        atualizarEnderecoLocal()
        atualizarStatusConexaoSite()
        configurarBotoes()
        processarDeepLink(intent)
        AppUpdateManager.syncAndCheckForUpdates(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        processarDeepLink(intent)
    }

    private fun configurarBotoes() {
        binding.btnTransmitirAgora.setOnClickListener {
            if (isStreaming) {
                pararEspelhamento()
            } else if (!FloatingBroadcastService.isOverlayVisible) {
                solicitarOuIniciarBotaoFlutuante()
            } else {
                pendingDirectScreen = true
                pendingLaunchAfterStart = false
                iniciarSolicitacaoCaptura(directScreen = true)
            }
        }

        binding.btnBotaoFlutuante.setOnClickListener {
            if (FloatingBroadcastService.isOverlayVisible) {
                pararBotaoFlutuante()
            } else {
                solicitarOuIniciarBotaoFlutuante()
            }
        }

        binding.btnConectarSite.setOnClickListener {
            conectarSiteAoVivo()
        }

        binding.btnBuscarAppNativo.setOnClickListener {
            val query = binding.inputBuscarAppNativo.text?.toString().orEmpty()
            filtrarAppsNativos(query)
        }

        binding.spinnerAppsNativos.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: AdapterView<*>?,
                view: android.view.View?,
                position: Int,
                id: Long
            ) {
                val app = displayedApps.getOrNull(position) ?: return
                val prefs = getSharedPreferences(ScreenMirrorService.PREFS_BROADCASTER, Context.MODE_PRIVATE)
                prefs.edit()
                    .putString(ScreenMirrorService.KEY_TARGET_PACKAGE, app.packageName.orEmpty())
                    .putString(ScreenMirrorService.KEY_SOURCE_APP, app.label)
                    .apply()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        binding.btnIniciarEAbrirApp.setOnClickListener {
            pendingDirectScreen = false
            if (isStreaming) {
                abrirAppNativoSelecionado()
            } else {
                pendingLaunchAfterStart = true
                iniciarSolicitacaoCaptura(directScreen = false)
            }
        }

        binding.btnAbrirAppNativo.setOnClickListener {
            abrirAppNativoSelecionado()
        }

        binding.btnToggleStream.setOnClickListener {
            if (isStreaming) {
                pararEspelhamento()
            } else {
                pendingDirectScreen = true
                pendingLaunchAfterStart = false
                iniciarSolicitacaoCaptura(directScreen = true)
            }
        }

        binding.btnCopiarUrl.setOnClickListener {
            val url = binding.txtUrlLocal.text.toString()
            val token = ScreenMirrorService.sessionToken
            val payload = if (token.isNotBlank()) "$url · Token: $token" else url
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("Jogos do Mengão App", payload))
            Toast.makeText(this, "Dados copiados para abrir na TV", Toast.LENGTH_SHORT).show()
        }

        binding.btnModoReceptor.setOnClickListener {
            val viewerIntent = Intent(this, ViewerActivity::class.java).apply {
                putExtra(EXTRA_AUTH_MODE, authMode)
                putExtra(EXTRA_AUTH_TOKEN, authToken)
            }
            startActivity(viewerIntent)
        }
    }

    private fun processarDeepLink(launchIntent: Intent?) {
        val data: Uri = launchIntent?.data ?: return
        if (data.scheme != "jogosdomengao") return

        val serverUrl = data.getQueryParameter("server")?.trim().orEmpty()
        val adminToken = data.getQueryParameter("token")?.trim().orEmpty()
        val title = data.getQueryParameter("title")?.trim().orEmpty()
        val query = data.getQueryParameter("query")?.trim().orEmpty()
        val pkg = data.getQueryParameter("pkg")?.trim().orEmpty()
        val autoStart = data.getQueryParameter("auto") == "1"
        val wantsOverlay = data.getQueryParameter("overlay") != "0"
        val directScreen = data.getQueryParameter("direct") != "0"

        val prefs = getSharedPreferences(ScreenMirrorService.PREFS_BROADCASTER, Context.MODE_PRIVATE)
        prefs.edit().apply {
            if (serverUrl.isNotBlank()) putString(ScreenMirrorService.KEY_SERVER_URL, serverUrl)
            if (adminToken.isNotBlank()) putString(ScreenMirrorService.KEY_ADMIN_TOKEN, adminToken)
            if (title.isNotBlank()) putString(ScreenMirrorService.KEY_BROADCAST_TITLE, title)
            if (pkg.isNotBlank()) putString(ScreenMirrorService.KEY_TARGET_PACKAGE, pkg)
            apply()
        }

        if (adminToken.isNotBlank()) {
            authMode = "admin_handoff"
            binding.txtAssinante.text = "Admin conectado · Transmissão Ao Vivo"
        }
        atualizarStatusConexaoSite()

        if (query.isNotBlank() || pkg.isNotBlank()) {
            val term = if (pkg.isNotBlank()) pkg else query
            binding.inputBuscarAppNativo.setText(query.ifBlank { pkg })
            filtrarAppsNativos(term)
        }

        if (wantsOverlay) {
            solicitarOuIniciarBotaoFlutuante()
        }

        if (autoStart && !isStreaming) {
            pendingDirectScreen = directScreen && query.isBlank() && pkg.isBlank()
            pendingLaunchAfterStart = !pendingDirectScreen && getSelectedNativeApp()?.packageName != null
            iniciarSolicitacaoCaptura(directScreen = pendingDirectScreen)
        }
    }

    private fun carregarAppsNativosInstalados() {
        val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val resolveList = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(
                launcherIntent,
                PackageManager.ResolveInfoFlags.of(0L)
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(launcherIntent, 0)
        }

        val discovered = resolveList
            .mapNotNull { info ->
                val pkg = info.activityInfo?.packageName ?: return@mapNotNull null
                if (pkg == packageName) return@mapNotNull null
                val label = info.loadLabel(packageManager)?.toString()?.trim().orEmpty()
                if (label.isBlank()) return@mapNotNull null
                NativeAppItem(label = label, packageName = pkg)
            }
            .distinctBy { it.packageName }
            .sortedWith(
                compareBy<NativeAppItem> { item ->
                    val idx = priorityPackages.indexOf(item.packageName)
                    if (idx >= 0) idx else Int.MAX_VALUE
                }.thenBy { it.label.lowercase() }
            )

        allInstalledApps = if (discovered.isNotEmpty()) {
            discovered
        } else {
            listOf(
                NativeAppItem("FlaTV+", "com.flamengo.flatv", "https://flatvmais.com.br"),
                NativeAppItem("Premiere", "com.globo.premierefc", "https://premiere.globo.com"),
                NativeAppItem("Globoplay", "com.globo.globotv", "https://globoplay.globo.com"),
                NativeAppItem("YouTube / CazéTV", "com.google.android.youtube", "https://www.youtube.com/@CazeTV")
            )
        }

        filtrarAppsNativos(binding.inputBuscarAppNativo.text?.toString().orEmpty())
    }

    private fun filtrarAppsNativos(rawQuery: String) {
        val q = rawQuery.trim().lowercase()
        val matched = if (q.isBlank()) {
            allInstalledApps
        } else {
            allInstalledApps.filter {
                it.label.lowercase().contains(q) ||
                    (it.packageName?.lowercase()?.contains(q) == true)
            }
        }

        displayedApps = if (matched.isNotEmpty()) matched else allInstalledApps

        val labels = displayedApps.map { "${it.label} (${it.packageName ?: "web"})" }
        binding.spinnerAppsNativos.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            labels
        )

        binding.txtResultadoBuscaApp.text = when {
            q.isBlank() -> "${allInstalledApps.size} apps nativos encontrados neste celular."
            matched.isNotEmpty() ->
                "Encontrado(s) ${matched.size} app(s) para \"$rawQuery\": ${matched.first().label}"
            else ->
                "Nenhum app com \"$rawQuery\" instalado; mostrando todos (${allInstalledApps.size})."
        }
    }

    private fun getSelectedNativeApp(): NativeAppItem? {
        val index = binding.spinnerAppsNativos.selectedItemPosition
        return displayedApps.getOrNull(index) ?: displayedApps.firstOrNull()
    }

    private fun solicitarPermissoesIniciais() {
        val missing = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            missing.add(Manifest.permission.RECORD_AUDIO)
        }
        if (missing.isNotEmpty()) {
            requestRuntimePermissions.launch(missing.toTypedArray())
        }
    }

    private fun solicitarOuIniciarBotaoFlutuante() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            Toast.makeText(
                this,
                "Ative a permissão para o botão flutuante INICIAR TRANSMISSÃO aparecer sobre qualquer app.",
                Toast.LENGTH_LONG
            ).show()
            overlayPermissionLauncher.launch(intent)
            return
        }
        iniciarBotaoFlutuante()
    }

    private fun iniciarBotaoFlutuante() {
        val intent = Intent(this, FloatingBroadcastService::class.java).apply {
            action = FloatingBroadcastService.ACTION_SHOW
        }
        startService(intent)
        atualizarEstadoUi(isStreaming)
        Toast.makeText(
            this,
            "Botão flutuante INICIAR TRANSMISSÃO ativo! Abra qualquer app (dentro ou fora) e toque nele para entrar ao vivo.",
            Toast.LENGTH_LONG
        ).show()
    }

    private fun pararBotaoFlutuante() {
        val intent = Intent(this, FloatingBroadcastService::class.java).apply {
            action = FloatingBroadcastService.ACTION_HIDE
        }
        startService(intent)
        atualizarBotaoFlutuanteLabel()
    }

    private fun abrirAppNativoSelecionado() {
        val item = getSelectedNativeApp()
        val pkg = item?.packageName

        if (!pkg.isNullOrBlank()) {
            val launchIntent = packageManager.getLaunchIntentForPackage(pkg)
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(launchIntent)
                Toast.makeText(this, "Abrindo ${item.label}...", Toast.LENGTH_SHORT).show()
                return
            }
            if (!item.fallbackUrl.isNullOrBlank()) {
                val webIntent = Intent(Intent.ACTION_VIEW, Uri.parse(item.fallbackUrl)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(webIntent)
                return
            }
        }

        val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val chooser = Intent.createChooser(launcherIntent, "Escolha o app para abrir")
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(chooser)
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(ScreenMirrorService.ACTION_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(stateReceiver, filter)
        }
    }

    override fun onStop() {
        super.onStop()
        runCatching { unregisterReceiver(stateReceiver) }
    }

    override fun onResume() {
        super.onResume()
        val prefs = getSharedPreferences(ScreenMirrorService.PREFS_BROADCASTER, Context.MODE_PRIVATE)
        val hasAdminHandoff = !prefs.getString(ScreenMirrorService.KEY_ADMIN_TOKEN, null).isNullOrBlank()

        if (authMode == "offline" && !hasAdminHandoff) {
            val offlineState = OfflineLicenseManager.getSavedLicenseState(this)
            if (!offlineState.ativo) {
                pararEspelhamento()
                Toast.makeText(
                    this,
                    offlineState.motivo ?: "Assinatura vencida. Renove para continuar.",
                    Toast.LENGTH_LONG
                ).show()
                startActivity(Intent(this, LoginActivity::class.java))
                finish()
                return
            }
            binding.txtAssinante.text =
                "Aparelho ${offlineState.deviceCode} · ${offlineState.plano ?: "Mensal Pro"} · ${offlineState.diasRestantes}d offline"
        }
        atualizarEstadoUi(ScreenMirrorService.isRunning)
        atualizarEnderecoLocal()
        atualizarBotaoFlutuanteLabel()
        AppUpdateManager.syncConfigOnly(this)
    }

    private fun iniciarSolicitacaoCaptura(directScreen: Boolean) {
        val captureIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            if (directScreen) {
                projectionManager.createScreenCaptureIntent(
                    MediaProjectionConfig.createConfigForDefaultDisplay()
                )
            } else {
                projectionManager.createScreenCaptureIntent(
                    MediaProjectionConfig.createConfigForUserChoice()
                )
            }
        } else {
            projectionManager.createScreenCaptureIntent()
        }
        screenCaptureLauncher.launch(captureIntent)
    }

    private fun pararEspelhamento() {
        val stopIntent = Intent(this, ScreenMirrorService::class.java).apply {
            action = ScreenMirrorService.ACTION_STOP
        }
        startService(stopIntent)
        atualizarEstadoUi(ativo = false)
    }

    private fun atualizarBotaoFlutuanteLabel() {
        binding.btnBotaoFlutuante.text = if (FloatingBroadcastService.isOverlayVisible) {
            "Ocultar Botão Flutuante \"INICIAR TRANSMISSÃO\""
        } else {
            "Ativar Botão Flutuante \"INICIAR TRANSMISSÃO\""
        }
    }

    private fun atualizarEstadoUi(ativo: Boolean) {
        isStreaming = ativo
        binding.btnTransmitirAgora.text = when {
            ativo -> "AO VIVO · PARAR TRANSMISSÃO"
            FloatingBroadcastService.isOverlayVisible -> "TRANSMITIR TELA AGORA"
            else -> "INICIAR TRANSMISSÃO"
        }
        binding.btnToggleStream.text =
            if (ativo) "Parar espelhamento" else "Espelhar tela direto (Sem app)"
        binding.btnIniciarEAbrirApp.text =
            if (ativo) "Abrir app encontrado agora" else "Transmitir e abrir app encontrado"
        val token = ScreenMirrorService.sessionToken
        val onlineLabel = if (ScreenMirrorService.isOnlineConnected) "Online + Wi-Fi" else "Wi-Fi Local"
        binding.txtStatusStream.text =
            if (ativo) "AO VIVO ($onlineLabel) · Token: $token (~20 FPS)"
            else if (FloatingBroadcastService.isOverlayVisible) "Botão flutuante INICIAR TRANSMISSÃO ativo sobre todos os apps"
            else "Aguardando início da transmissão"
        atualizarBotaoFlutuanteLabel()
    }

    private fun atualizarEnderecoLocal() {
        val ip = obterIpLocalWifi() ?: "127.0.0.1"
        binding.txtUrlLocal.text = "http://$ip:${ScreenMirrorService.HTTP_PORT}"
    }

    private fun atualizarStatusConexaoSite() {
        val prefs = getSharedPreferences(ScreenMirrorService.PREFS_BROADCASTER, Context.MODE_PRIVATE)
        val savedUrl = prefs.getString(ScreenMirrorService.KEY_SERVER_URL, null)
            ?.trim()
            ?.takeIf { it.isNotBlank() }
            ?: BuildConfig.API_BASE_URL.trim()
        val savedToken = prefs.getString(ScreenMirrorService.KEY_ADMIN_TOKEN, null)?.trim().orEmpty()

        if (binding.inputServerUrl.text.isNullOrBlank()) {
            binding.inputServerUrl.setText(savedUrl)
        }

        if (savedToken.isNotBlank() && savedUrl.startsWith("http")) {
            binding.txtConexaoSiteStatus.text = "Site conectado para live ao vivo: $savedUrl"
            binding.txtConexaoSiteStatus.setTextColor(Color.parseColor("#34D399"))
        } else {
            binding.txtConexaoSiteStatus.text = "Não conectado ao site ainda (somente Wi-Fi local)."
            binding.txtConexaoSiteStatus.setTextColor(Color.parseColor("#A1A1AA"))
        }
    }

    private fun conectarSiteAoVivo() {
        val rawUrl = binding.inputServerUrl.text?.toString()?.trim().orEmpty().trimEnd('/')
        val password = binding.inputAdminPasscode.text?.toString()?.trim().orEmpty()

        if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
            Toast.makeText(this, "Informe a URL completa do site (https://...).", Toast.LENGTH_SHORT).show()
            return
        }
        if (password.isBlank()) {
            Toast.makeText(this, "Digite a senha de administrador do site.", Toast.LENGTH_SHORT).show()
            return
        }

        binding.btnConectarSite.isEnabled = false
        binding.btnConectarSite.text = "Conectando ao site..."
        binding.txtConexaoSiteStatus.text = "Autenticando transmissor no servidor..."
        binding.txtConexaoSiteStatus.setTextColor(Color.parseColor("#FBBF24"))

        lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching {
                val payload = JSONObject().put("password", password).toString()
                val req = Request.Builder()
                    .url("$rawUrl/api/admin/login-passcode")
                    .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .build()

                httpClient.newCall(req).execute().use { resp ->
                    val bodyStr = resp.body?.string().orEmpty()
                    val json = runCatching { JSONObject(bodyStr) }.getOrNull()
                    if (!resp.isSuccessful) {
                        val msg = json?.optString("erro")?.takeIf { it.isNotBlank() }
                            ?: "Erro HTTP ${resp.code}"
                        throw IllegalStateException(msg)
                    }
                    val token = json?.optString("token").orEmpty()
                    if (token.isBlank()) {
                        throw IllegalStateException("Servidor não retornou token de transmissão.")
                    }
                    token
                }
            }

            withContext(Dispatchers.Main) {
                binding.btnConectarSite.isEnabled = true
                binding.btnConectarSite.text = "Conectar Site Ao Vivo"

                result.onSuccess { token ->
                    getSharedPreferences(ScreenMirrorService.PREFS_BROADCASTER, Context.MODE_PRIVATE)
                        .edit()
                        .putString(ScreenMirrorService.KEY_SERVER_URL, rawUrl)
                        .putString(ScreenMirrorService.KEY_ADMIN_TOKEN, token)
                        .apply()

                    authMode = "admin_handoff"
                    binding.inputAdminPasscode.setText("")
                    binding.txtAssinante.text = "Admin conectado · Transmissão Ao Vivo"
                    atualizarStatusConexaoSite()
                    Toast.makeText(
                        this@MainActivity,
                        "Site conectado! Aperte TRANSMITIR AGR para transmitir vídeo e áudio ao vivo.",
                        Toast.LENGTH_LONG
                    ).show()
                }.onFailure { err ->
                    binding.txtConexaoSiteStatus.text =
                        err.message ?: "Falha ao conectar no servidor."
                    binding.txtConexaoSiteStatus.setTextColor(Color.parseColor("#F87171"))
                }
            }
        }
    }

    private fun obterIpLocalWifi(): String? {
        return runCatching {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.toList() }
                .firstOrNull { addr -> addr is Inet4Address && !addr.isLoopbackAddress && addr.isSiteLocalAddress }
                ?.hostAddress
        }.getOrNull()
    }
}
