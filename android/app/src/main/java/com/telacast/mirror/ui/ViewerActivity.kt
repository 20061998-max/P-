package com.telacast.mirror.ui

import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.telacast.mirror.data.AppUpdateManager
import com.telacast.mirror.data.OfflineLicenseManager
import com.telacast.mirror.databinding.ActivityViewerBinding
import com.telacast.mirror.service.ScreenMirrorService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.coroutineContext

class ViewerActivity : AppCompatActivity() {

    private enum class SourceMode {
        ONLINE_LIVE,
        LAN_WIFI
    }

    private lateinit var binding: ActivityViewerBinding
    private var streamJob: Job? = null
    private var liveWebSocket: WebSocket? = null
    private var audioTrack: AudioTrack? = null
    private var audioSampleRate: Int = 24000
    private val decodingVideoFrame = AtomicBoolean(false)

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    private var authMode: String = "offline"
    private var authToken: String = ""
    private var sourceMode: SourceMode = SourceMode.ONLINE_LIVE

    private fun isRunningOnTv(): Boolean {
        val uiModeManager = getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
        return uiModeManager.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Proteção anti-retransmissão: impede captura de tela, gravação ou espelhamento da tela do player
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
        authMode = intent.getStringExtra(MainActivity.EXTRA_AUTH_MODE) ?: "offline"
        authToken = intent.getStringExtra(MainActivity.EXTRA_AUTH_TOKEN) ?: ""
        binding = ActivityViewerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnModoOnline.setOnClickListener {
            if (sourceMode != SourceMode.ONLINE_LIVE) {
                desconectar()
                sourceMode = SourceMode.ONLINE_LIVE
                atualizarUiModo()
            }
        }

        binding.btnModoWifi.setOnClickListener {
            if (sourceMode != SourceMode.LAN_WIFI) {
                desconectar()
                sourceMode = SourceMode.LAN_WIFI
                atualizarUiModo()
            }
        }

        binding.btnConectar.setOnClickListener {
            if (isConnectedOrConnecting()) {
                desconectar()
            } else if (sourceMode == SourceMode.ONLINE_LIVE) {
                conectarAoVivoOnline()
            } else {
                if (!isRunningOnTv()) {
                    Toast.makeText(
                        this,
                        "Proteção ativa: retransmissão Wi-Fi permitida somente em Smart TVs.",
                        Toast.LENGTH_LONG
                    ).show()
                    return@setOnClickListener
                }
                val baseUrl = binding.inputEndereco.text?.toString().orEmpty().trim().trimEnd('/')
                val token = binding.inputToken.text?.toString().orEmpty().trim()
                if (baseUrl.isBlank() || token.isBlank()) {
                    Toast.makeText(this, "Informe o endereço IP e o token da sessão.", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                conectarStreamLan("$baseUrl/stream?token=$token")
            }
        }

        atualizarUiModo()
        AppUpdateManager.syncAndCheckForUpdates(this)
    }

    override fun onResume() {
        super.onResume()
        if (authMode == "offline" && !OfflineLicenseManager.getSavedLicenseState(this).ativo) {
            desconectar()
            Toast.makeText(this, "Assinatura vencida. Renove para assistir.", Toast.LENGTH_LONG).show()
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }
    }

    private fun isConnectedOrConnecting(): Boolean {
        return streamJob?.isActive == true || liveWebSocket != null
    }

    private fun atualizarUiModo() {
        val online = sourceMode == SourceMode.ONLINE_LIVE
        binding.layoutWifiInputs.visibility = if (online) View.GONE else View.VISIBLE
        binding.btnModoOnline.alpha = if (online) 1.0f else 0.55f
        binding.btnModoWifi.alpha = if (online) 0.55f else 1.0f

        if (!isConnectedOrConnecting()) {
            binding.btnConectar.text = if (online) "Assistir Ao Vivo Online" else "Assistir transmissão Wi-Fi"
            binding.txtViewerStatus.text = if (online) {
                "Toque em Assistir Ao Vivo Online para receber a transmissão do administrador com áudio e vídeo"
            } else {
                "Informe o IP e o token para assistir pela rede Wi-Fi (Smart TV)"
            }
            binding.txtViewerStatus.visibility = View.VISIBLE
        }
    }

    private fun conectarAoVivoOnline() {
        val wsUrl = OfflineLicenseManager.getLiveWebSocketUrl()
        if (wsUrl.isNullOrBlank()) {
            Toast.makeText(this, "URL do servidor não configurada neste APK.", Toast.LENGTH_LONG).show()
            return
        }

        val deviceCode = OfflineLicenseManager.getOrCreateDeviceCode(this)
        val activationKey = OfflineLicenseManager.getSavedActivationKey(this).orEmpty()
        if (activationKey.isBlank() && authToken.isBlank()) {
            Toast.makeText(this, "Ative uma chave offline ou faça login online para assistir.", Toast.LENGTH_LONG).show()
            return
        }

        binding.btnConectar.text = "Desconectar"
        binding.txtViewerStatus.text = "Conectando à transmissão ao vivo..."
        binding.txtViewerStatus.visibility = View.VISIBLE

        val request = Request.Builder().url(wsUrl).build()
        liveWebSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val authPayload = JSONObject().apply {
                    put("type", "auth:viewer")
                    put("deviceCode", deviceCode)
                    put("activationKey", activationKey)
                    if (authToken.isNotBlank()) {
                        put("authToken", authToken)
                    }
                }
                webSocket.send(authPayload.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val json = runCatching { JSONObject(text) }.getOrNull() ?: return
                val msgType = json.optString("type", "")
                when (msgType) {
                    "auth:error" -> {
                        val erro = json.optString("erro", "Assinatura necessária para assistir ao vivo.")
                        runOnUiThread {
                            if (isFinishing || isDestroyed) return@runOnUiThread
                            binding.txtViewerStatus.text = erro
                            binding.txtViewerStatus.visibility = View.VISIBLE
                            desconectarSocketSilencioso()
                            binding.btnConectar.text = "Assistir Ao Vivo Online"
                        }
                    }

                    "auth:ok", "live:state" -> {
                        val state = json.optJSONObject("state") ?: return
                        val isLive = state.optBoolean("isLive", false)
                        val title = state.optString("title", "Transmissão Ao Vivo")
                        val sourceApp = state.optString("sourceApp", "App selecionado")
                        val sampleRate = state.optInt("sampleRate", 24000).coerceIn(8000, 48000)
                        if (sampleRate != audioSampleRate) {
                            audioSampleRate = sampleRate
                            reiniciarAudioTrack()
                        }
                        runOnUiThread {
                            if (isFinishing || isDestroyed) return@runOnUiThread
                            if (!isLive) {
                                binding.txtViewerStatus.text =
                                    "Conectado · Aguardando o administrador iniciar a transmissão ao vivo..."
                                binding.txtViewerStatus.visibility = View.VISIBLE
                            } else {
                                binding.txtViewerStatus.text = "$title · $sourceApp"
                                binding.txtViewerStatus.visibility = View.VISIBLE
                            }
                        }
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val raw = bytes.toByteArray()
                if (raw.size < 2) return
                when (raw[0].toInt() and 0xFF) {
                    0x01 -> {
                        if (!decodingVideoFrame.compareAndSet(false, true)) return
                        val bitmap = runCatching {
                            BitmapFactory.decodeByteArray(raw, 1, raw.size - 1)
                        }.getOrNull()
                        if (bitmap != null) {
                            runOnUiThread {
                                if (!isFinishing && !isDestroyed) {
                                    binding.imgStream.setImageBitmap(bitmap)
                                    binding.txtViewerStatus.visibility = View.GONE
                                }
                                decodingVideoFrame.set(false)
                            }
                        } else {
                            decodingVideoFrame.set(false)
                        }
                    }

                    0x02 -> {
                        reproduzirPcmAudio(raw, 1, raw.size - 1)
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                runOnUiThread {
                    if (liveWebSocket === webSocket) {
                        liveWebSocket = null
                        liberarAudioTrack()
                        binding.txtViewerStatus.text =
                            "Falha na conexão ao vivo: ${t.localizedMessage ?: "verifique sua internet"}"
                        binding.txtViewerStatus.visibility = View.VISIBLE
                        binding.btnConectar.text = "Assistir Ao Vivo Online"
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                runOnUiThread {
                    if (liveWebSocket === webSocket) {
                        liveWebSocket = null
                        liberarAudioTrack()
                        binding.btnConectar.text = "Assistir Ao Vivo Online"
                        if (binding.txtViewerStatus.visibility != View.VISIBLE) {
                            binding.txtViewerStatus.text = "Transmissão encerrada."
                            binding.txtViewerStatus.visibility = View.VISIBLE
                        }
                    }
                }
            }
        })
    }

    private fun garantirAudioTrack(): AudioTrack? {
        val current = audioTrack
        if (current != null && current.state == AudioTrack.STATE_INITIALIZED) {
            return current
        }
        return runCatching {
            val minBuf = AudioTrack.getMinBufferSize(
                audioSampleRate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            ).coerceAtLeast(4096)

            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(audioSampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(minBuf * 2)
                .build()
            track.play()
            audioTrack = track
            track
        }.getOrNull()
    }

    private fun reproduzirPcmAudio(buffer: ByteArray, offset: Int, length: Int) {
        if (length <= 1) return
        val track = garantirAudioTrack() ?: return
        runCatching {
            track.write(buffer, offset, length, AudioTrack.WRITE_NON_BLOCKING)
        }
    }

    private fun reiniciarAudioTrack() {
        liberarAudioTrack()
    }

    private fun liberarAudioTrack() {
        val track = audioTrack
        audioTrack = null
        if (track != null) {
            runCatching {
                track.pause()
                track.flush()
                track.release()
            }
        }
    }

    private fun conectarStreamLan(url: String) {
        binding.btnConectar.text = "Desconectar"
        binding.txtViewerStatus.text = "Conectando ao transmissor Wi-Fi..."
        binding.txtViewerStatus.visibility = View.VISIBLE

        val isTv = isRunningOnTv()
        streamJob = lifecycleScope.launch(Dispatchers.IO) {
            try {
                val req = Request.Builder()
                    .url(url)
                    .addHeader(
                        ScreenMirrorService.APP_CLIENT_HEADER,
                        if (isTv) ScreenMirrorService.TV_CLIENT_SIGNATURE else ScreenMirrorService.APP_CLIENT_SIGNATURE
                    )
                    .addHeader(
                        ScreenMirrorService.DEVICE_TYPE_HEADER,
                        if (isTv) "tv" else "mobile"
                    )
                    .get()
                    .build()

                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) {
                        withContext(Dispatchers.Main) {
                            binding.txtViewerStatus.text = "Acesso negado (HTTP ${res.code}). Verifique o token."
                            binding.btnConectar.text = "Assistir transmissão Wi-Fi"
                        }
                        return@launch
                    }

                    val inputStream: InputStream = res.body?.byteStream() ?: return@launch
                    withContext(Dispatchers.Main) {
                        binding.txtViewerStatus.visibility = View.GONE
                    }

                    lerQuadrosMjpeg(inputStream) { jpegBytes ->
                        val bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)
                        if (bitmap != null) {
                            withContext(Dispatchers.Main) {
                                binding.imgStream.setImageBitmap(bitmap)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.txtViewerStatus.text = "Conexão encerrada: ${e.localizedMessage ?: "erro"}"
                    binding.txtViewerStatus.visibility = View.VISIBLE
                    binding.btnConectar.text = "Assistir transmissão Wi-Fi"
                }
            }
        }
    }

    private suspend fun lerQuadrosMjpeg(
        stream: InputStream,
        onFrame: suspend (ByteArray) -> Unit
    ) {
        val buffer = ByteArrayOutputStream()
        var prev = -1
        var insideJpeg = false

        while (coroutineContext.isActive) {
            val b = stream.read()
            if (b == -1) break

            if (!insideJpeg) {
                if (prev == 0xFF && b == 0xD8) {
                    insideJpeg = true
                    buffer.reset()
                    buffer.write(0xFF)
                    buffer.write(0xD8)
                }
            } else {
                buffer.write(b)
                if (prev == 0xFF && b == 0xD9) {
                    insideJpeg = false
                    onFrame(buffer.toByteArray())
                }
            }
            prev = b
        }
    }

    private fun desconectarSocketSilencioso() {
        val ws = liveWebSocket
        liveWebSocket = null
        ws?.close(1000, "Desconectado")
        liberarAudioTrack()
    }

    private fun desconectar() {
        streamJob?.cancel()
        streamJob = null
        desconectarSocketSilencioso()
        decodingVideoFrame.set(false)
        binding.btnConectar.text =
            if (sourceMode == SourceMode.ONLINE_LIVE) "Assistir Ao Vivo Online" else "Assistir transmissão Wi-Fi"
        binding.txtViewerStatus.text = "Desconectado"
        binding.txtViewerStatus.visibility = View.VISIBLE
    }

    override fun onDestroy() {
        desconectar()
        super.onDestroy()
    }
}
