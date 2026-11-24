package com.telacast.mirror.service

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.ImageReader
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.telacast.mirror.BuildConfig
import com.telacast.mirror.R
import com.telacast.mirror.ui.MainActivity
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class ScreenMirrorService : Service() {

    companion object {
        const val ACTION_START = "com.telacast.mirror.ACTION_START"
        const val ACTION_STOP = "com.telacast.mirror.ACTION_STOP"
        const val ACTION_STATE_CHANGED = "com.telacast.mirror.ACTION_STATE_CHANGED"
        const val EXTRA_RESULT_CODE = "extra_result_code"
        const val EXTRA_RESULT_DATA = "extra_result_data"
        const val EXTRA_SERVER_URL = "extra_server_url"
        const val EXTRA_ADMIN_TOKEN = "extra_admin_token"
        const val EXTRA_BROADCAST_TITLE = "extra_broadcast_title"
        const val EXTRA_SOURCE_APP = "extra_source_app"

        const val PREFS_BROADCASTER = "telacast_broadcaster_prefs"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_ADMIN_TOKEN = "admin_token"
        const val KEY_BROADCAST_TITLE = "broadcast_title"
        const val KEY_SOURCE_APP = "source_app"
        const val KEY_TARGET_PACKAGE = "target_package"

        const val HTTP_PORT = 8080
        const val APP_CLIENT_HEADER = "X-TelaCast-App"
        const val APP_CLIENT_SIGNATURE = "Android-Client/1.0"
        const val PWA_CLIENT_SIGNATURE = "TelaCast-PWA-App/1.0"
        const val WEBOS_CLIENT_SIGNATURE = "TelaCast-LG-webOS/1.0"
        const val TV_CLIENT_SIGNATURE = "TelaCast-TV-App/1.0"
        const val DEVICE_TYPE_HEADER = "X-Device-Type"

        @Volatile
        var onlyAllowTvReceivers = true

        private const val MAX_TV_CLIENTS = 2
        private const val NOTIFICATION_CHANNEL_ID = "mengao_mirror_channel"
        private const val NOTIFICATION_ID = 1042
        private const val JPEG_QUALITY = 70
        private const val TARGET_FRAME_INTERVAL_MS = 50L // ~20 FPS
        private const val AUDIO_SAMPLE_RATE = 24000
        private const val BOUNDARY = "frame"

        @Volatile
        var isRunning = false
            private set

        @Volatile
        var isOnlineConnected = false
            private set

        @Volatile
        var sessionToken: String = ""
            private set

        @Volatile
        var startedAtMillis: Long = 0L
            private set
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureThread: HandlerThread? = null
    private var captureHandler: Handler? = null

    private var serverSocket: ServerSocket? = null
    private var serverThread: Thread? = null
    private val serverActive = AtomicBoolean(false)
    private val streamClients = CopyOnWriteArrayList<BufferedOutputStream>()
    private var wakeLock: PowerManager.WakeLock? = null

    private var liveWebSocket: WebSocket? = null
    private val onlineSocketAuthed = AtomicBoolean(false)
    private val wsClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var audioRecord: AudioRecord? = null
    private var audioThread: Thread? = null
    private val audioActive = AtomicBoolean(false)

    @Volatile
    private var lastFrameSentAt = 0L

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            encerrarTudo()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                encerrarTudo()
                return START_NOT_STICKY
            }

            ACTION_START -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
                val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }

                if (resultCode != Activity.RESULT_OK || resultData == null) {
                    stopSelf()
                    return START_NOT_STICKY
                }

                val prefs = getSharedPreferences(PREFS_BROADCASTER, Context.MODE_PRIVATE)
                val serverUrl = intent.getStringExtra(EXTRA_SERVER_URL)?.trim()
                    ?: prefs.getString(KEY_SERVER_URL, null)?.trim()
                    ?: BuildConfig.API_BASE_URL.trim()
                val adminToken = intent.getStringExtra(EXTRA_ADMIN_TOKEN)?.trim()
                    ?: prefs.getString(KEY_ADMIN_TOKEN, null)?.trim()
                    ?: ""
                val title = intent.getStringExtra(EXTRA_BROADCAST_TITLE)?.trim()
                    ?: prefs.getString(KEY_BROADCAST_TITLE, null)?.trim()
                    ?: "Jogos do Mengão · Ao Vivo"
                val sourceApp = intent.getStringExtra(EXTRA_SOURCE_APP)?.trim()
                    ?: prefs.getString(KEY_SOURCE_APP, null)?.trim()
                    ?: "Tela Direta do Celular"

                sessionToken = "TC-${UUID.randomUUID().toString().take(6).uppercase()}"
                iniciarForegroundService()
                iniciarCapturaEHttp(resultCode, resultData, serverUrl, adminToken, title, sourceApp)
            }
        }
        return START_NOT_STICKY
    }

    private fun notificarEstado() {
        sendBroadcast(Intent(ACTION_STATE_CHANGED).setPackage(packageName))
        FloatingBroadcastService.refreshOverlay(this)
    }

    private fun iniciarForegroundService() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Transmissão Jogos do Mengão",
                NotificationManager.IMPORTANCE_LOW
            )
            manager.createNotificationChannel(channel)
        }

        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        val notification: Notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Transmitindo tela ao vivo · Jogos do Mengão")
            .setContentText("Token local: $sessionToken · Porta $HTTP_PORT")
            .setSmallIcon(R.drawable.ic_launcher_mengao)
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        runCatching {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "JogosDoMengao::LiveBroadcast")
            }
            if (wakeLock?.isHeld == false) {
                wakeLock?.acquire(6 * 60 * 60 * 1000L)
            }
        }
        startedAtMillis = System.currentTimeMillis()
        isRunning = true
        notificarEstado()
    }

    private fun iniciarCapturaEHttp(
        resultCode: Int,
        resultData: Intent,
        serverUrl: String,
        adminToken: String,
        title: String,
        sourceApp: String
    ) {
        val projectionManager =
            getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = projectionManager.getMediaProjection(resultCode, resultData)?.also { mp ->
            mp.registerCallback(projectionCallback, Handler(Looper.getMainLooper()))
        }
        mediaProjection = projection

        val (width, height, density) = calcularResolucaoCaptura()

        captureThread = HandlerThread("MengaoCapture").apply { start() }
        captureHandler = Handler(captureThread!!.looper)

        val canCaptureAudio =
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

        if (adminToken.isNotBlank() && serverUrl.startsWith("http")) {
            conectarOnlineRelay(serverUrl, adminToken, title, sourceApp, canCaptureAudio)
        }

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2).apply {
            setOnImageAvailableListener({ reader ->
                val agora = System.currentTimeMillis()
                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                try {
                    val hasOnline = onlineSocketAuthed.get() && liveWebSocket != null
                    if (agora - lastFrameSentAt < TARGET_FRAME_INTERVAL_MS ||
                        (streamClients.isEmpty() && !hasOnline)
                    ) {
                        return@setOnImageAvailableListener
                    }
                    lastFrameSentAt = agora

                    val plane = image.planes[0]
                    val buffer: ByteBuffer = plane.buffer
                    val pixelStride = plane.pixelStride
                    val rowStride = plane.rowStride
                    val rowPadding = rowStride - pixelStride * width

                    val bitmap = Bitmap.createBitmap(
                        width + rowPadding / pixelStride,
                        height,
                        Bitmap.Config.ARGB_8888
                    )
                    bitmap.copyPixelsFromBuffer(buffer)

                    val cropped = if (rowPadding > 0) {
                        Bitmap.createBitmap(bitmap, 0, 0, width, height).also { bitmap.recycle() }
                    } else {
                        bitmap
                    }

                    val baos = ByteArrayOutputStream()
                    cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, baos)
                    cropped.recycle()

                    val jpegBytes = baos.toByteArray()
                    transmitirFrameParaClientes(jpegBytes)
                    enviarFrameOnline(jpegBytes)
                } finally {
                    image.close()
                }
            }, captureHandler)
        }

        virtualDisplay = projection?.createVirtualDisplay(
            "JogosDoMengaoVirtualDisplay",
            width,
            height,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            captureHandler
        )

        if (canCaptureAudio && adminToken.isNotBlank()) {
            iniciarCapturaAudioInterno(projection)
        }

        iniciarServidorHttp()
    }

    private fun conectarOnlineRelay(
        serverUrl: String,
        adminToken: String,
        title: String,
        sourceApp: String,
        hasAudio: Boolean
    ) {
        val cleanBase = serverUrl.trim().trimEnd('/')
        val wsUrl = when {
            cleanBase.startsWith("https://") -> "wss://${cleanBase.removePrefix("https://")}/ws/live"
            cleanBase.startsWith("http://") -> "ws://${cleanBase.removePrefix("http://")}/ws/live"
            else -> return
        }

        val req = Request.Builder().url(wsUrl).build()
        liveWebSocket = wsClient.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val payload = JSONObject().apply {
                    put("type", "auth:broadcaster")
                    put("idToken", adminToken)
                    put("title", title)
                    put("sourceApp", sourceApp)
                    put("hasAudio", hasAudio)
                    put("sampleRate", AUDIO_SAMPLE_RATE)
                }
                webSocket.send(payload.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val json = runCatching { JSONObject(text) }.getOrNull() ?: return
                when (json.optString("type")) {
                    "auth:ok" -> {
                        onlineSocketAuthed.set(true)
                        isOnlineConnected = true
                        notificarEstado()
                    }
                    "auth:error", "broadcast:superseded" -> {
                        onlineSocketAuthed.set(false)
                        isOnlineConnected = false
                        notificarEstado()
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onlineSocketAuthed.set(false)
                isOnlineConnected = false
                notificarEstado()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onlineSocketAuthed.set(false)
                isOnlineConnected = false
                notificarEstado()
            }
        })
    }

    private fun enviarFrameOnline(jpegBytes: ByteArray) {
        val ws = liveWebSocket ?: return
        if (!onlineSocketAuthed.get() || ws.queueSize() > 512 * 1024L) return
        val packet = ByteArray(1 + jpegBytes.size)
        packet[0] = 0x01
        System.arraycopy(jpegBytes, 0, packet, 1, jpegBytes.size)
        ws.send(packet.toByteString(0, packet.size))
    }

    @SuppressLint("MissingPermission")
    private fun iniciarCapturaAudioInterno(projection: MediaProjection?) {
        runCatching {
            val format = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(AUDIO_SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .build()

            val minBuf = AudioRecord.getMinBufferSize(
                AUDIO_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            ).coerceAtLeast(4096)

            var record: AudioRecord? = null

            // Tenta primeiro capturar o áudio interno do sistema/jogo (Android 10+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && projection != null) {
                record = runCatching {
                    val config = AudioPlaybackCaptureConfiguration.Builder(projection)
                        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                        .addMatchingUsage(AudioAttributes.USAGE_GAME)
                        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                        .build()

                    AudioRecord.Builder()
                        .setAudioFormat(format)
                        .setBufferSizeInBytes(minBuf * 2)
                        .setAudioPlaybackCaptureConfig(config)
                        .build()
                        .takeIf { it.state == AudioRecord.STATE_INITIALIZED }
                }.getOrNull()
            }

            // Fallback para microfone se áudio interno não estiver disponível
            if (record == null) {
                record = runCatching {
                    AudioRecord.Builder()
                        .setAudioSource(MediaRecorder.AudioSource.MIC)
                        .setAudioFormat(format)
                        .setBufferSizeInBytes(minBuf * 2)
                        .build()
                        .takeIf { it.state == AudioRecord.STATE_INITIALIZED }
                }.getOrNull()
            }

            val activeRecord = record ?: return

            audioRecord = activeRecord
            audioActive.set(true)
            activeRecord.startRecording()

            audioThread = Thread {
                val pcmBuffer = ByteArray(4096)
                while (audioActive.get()) {
                    val read = activeRecord.read(pcmBuffer, 0, pcmBuffer.size)
                    if (read > 0) {
                        val ws = liveWebSocket
                        if (ws != null && onlineSocketAuthed.get() && ws.queueSize() < 256 * 1024L) {
                            val packet = ByteArray(1 + read)
                            packet[0] = 0x02
                            System.arraycopy(pcmBuffer, 0, packet, 1, read)
                            ws.send(packet.toByteString(0, packet.size))
                        }
                    }
                }
            }.apply { start() }
        }
    }

    private fun calcularResolucaoCaptura(): Triple<Int, Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)

        val scale = if (metrics.widthPixels > 720) 720f / metrics.widthPixels else 1f
        val w = (metrics.widthPixels * scale).toInt().coerceAtLeast(360)
        val h = (metrics.heightPixels * scale).toInt().coerceAtLeast(640)
        return Triple(w, h, metrics.densityDpi)
    }

    private fun iniciarServidorHttp() {
        serverActive.set(true)
        serverThread = Thread {
            runCatching {
                serverSocket = ServerSocket(HTTP_PORT)
                while (serverActive.get()) {
                    val socket = serverSocket?.accept() ?: break
                    Thread { atenderClienteHttp(socket) }.start()
                }
            }
        }.apply { start() }
    }

    private fun atenderClienteHttp(socket: Socket) {
        runCatching {
            val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
            val requestLine = reader.readLine() ?: return
            val parts = requestLine.split(" ")
            val method = parts.getOrNull(0) ?: "GET"
            val pathAndQuery = parts.getOrNull(1) ?: "/"

            val headersMap = mutableMapOf<String, String>()
            while (true) {
                val line = reader.readLine() ?: break
                if (line.isEmpty()) break
                val colon = line.indexOf(':')
                if (colon > 0) {
                    headersMap[line.substring(0, colon).trim().lowercase()] =
                        line.substring(colon + 1).trim()
                }
            }

            val out = BufferedOutputStream(socket.getOutputStream())
            if (method.equals("OPTIONS", ignoreCase = true)) {
                val corsHeaders = buildString {
                    append("HTTP/1.1 204 No Content\r\n")
                    append("Access-Control-Allow-Origin: *\r\n")
                    append("Access-Control-Allow-Methods: GET, OPTIONS\r\n")
                    append("Access-Control-Allow-Headers: $APP_CLIENT_HEADER, $DEVICE_TYPE_HEADER\r\n")
                    append("Connection: close\r\n\r\n")
                }
                out.write(corsHeaders.toByteArray(Charsets.US_ASCII))
                out.flush()
                socket.close()
                return
            }

            val clientSignature = headersMap[APP_CLIENT_HEADER.lowercase()]
            val deviceType = headersMap[DEVICE_TYPE_HEADER.lowercase()]
            val hasProxyRelayHeader =
                headersMap.containsKey("x-forwarded-for") || headersMap.containsKey("via")
            val queryToken = pathAndQuery.substringAfter("token=", "").substringBefore("&")

            // Proteção anti-retransmissão: bloqueia proxies e restringe retransmissão a Smart TVs
            val isTvClient =
                (clientSignature == WEBOS_CLIENT_SIGNATURE || clientSignature == TV_CLIENT_SIGNATURE) &&
                    deviceType == "tv"
            val isAllowedClient = if (onlyAllowTvReceivers) {
                isTvClient
            } else {
                clientSignature == APP_CLIENT_SIGNATURE ||
                    clientSignature == PWA_CLIENT_SIGNATURE ||
                    isTvClient
            }

            val isAuthorizedAppStream =
                pathAndQuery.startsWith("/stream") &&
                    !hasProxyRelayHeader &&
                    streamClients.size < MAX_TV_CLIENTS &&
                    isAllowedClient &&
                    queryToken.isNotBlank() &&
                    queryToken == sessionToken

            if (isAuthorizedAppStream) {
                val headers = buildString {
                    append("HTTP/1.1 200 OK\r\n")
                    append("Access-Control-Allow-Origin: *\r\n")
                    append("Cache-Control: no-store, no-cache, private\r\n")
                    append("Pragma: no-cache\r\n")
                    append("Connection: close\r\n")
                    append("Content-Type: multipart/x-mixed-replace; boundary=--$BOUNDARY\r\n\r\n")
                }
                out.write(headers.toByteArray(Charsets.US_ASCII))
                out.flush()
                streamClients.add(out)
            } else {
                val html = gerarHtmlBloqueioNavegador().toByteArray(Charsets.UTF_8)
                val headers = buildString {
                    append("HTTP/1.1 403 Forbidden\r\n")
                    append("Access-Control-Allow-Origin: *\r\n")
                    append("Content-Type: text/html; charset=utf-8\r\n")
                    append("Content-Length: ${html.size}\r\n")
                    append("Connection: close\r\n\r\n")
                }
                out.write(headers.toByteArray(Charsets.US_ASCII))
                out.write(html)
                out.flush()
                socket.close()
            }
        }.onFailure {
            runCatching { socket.close() }
        }
    }

    private fun transmitirFrameParaClientes(jpegBytes: ByteArray) {
        val header = ("--$BOUNDARY\r\n" +
            "Content-Type: image/jpeg\r\n" +
            "Content-Length: ${jpegBytes.size}\r\n\r\n").toByteArray(Charsets.US_ASCII)
        val footer = "\r\n".toByteArray(Charsets.US_ASCII)

        for (client in streamClients) {
            try {
                client.write(header)
                client.write(jpegBytes)
                client.write(footer)
                client.flush()
            } catch (_: Exception) {
                streamClients.remove(client)
                runCatching { client.close() }
            }
        }
    }

    private fun gerarHtmlBloqueioNavegador(): String = """
        <!doctype html>
        <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>TelaCast — Acesso exclusivo pelo App</title>
          <style>
            body {
              margin: 0; min-height: 100vh; display: flex; align-items: center;
              justify-content: center; background: #0f172a; color: #f8fafc;
              font-family: system-ui, -apple-system, sans-serif; padding: 24px;
            }
            .card {
              max-width: 420px; background: #1e293b; border: 1px solid #334155;
              border-radius: 14px; padding: 28px; text-align: center;
            }
            h1 { font-size: 20px; margin: 0 0 10px; }
            p { font-size: 14px; color: #cbd5e1; line-height: 1.5; margin: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Visualização bloqueada no navegador</h1>
            <p>Esta transmissão pode ser assistida exclusivamente pelo aplicativo TelaCast com o token da sessão.</p>
          </div>
        </body>
        </html>
    """.trimIndent()

    private fun encerrarTudo() {
        isRunning = false
        isOnlineConnected = false
        startedAtMillis = 0L
        onlineSocketAuthed.set(false)
        sessionToken = ""
        serverActive.set(false)

        audioActive.set(false)
        runCatching {
            audioRecord?.stop()
            audioRecord?.release()
        }
        audioRecord = null
        audioThread = null

        runCatching {
            if (liveWebSocket != null) {
                liveWebSocket?.send(JSONObject().put("type", "broadcast:stop").toString())
                liveWebSocket?.close(1000, "Stopped")
            }
        }
        liveWebSocket = null

        for (client in streamClients) {
            runCatching { client.close() }
        }
        streamClients.clear()

        runCatching { serverSocket?.close() }
        serverSocket = null

        virtualDisplay?.release()
        virtualDisplay = null

        imageReader?.close()
        imageReader = null

        mediaProjection?.unregisterCallback(projectionCallback)
        mediaProjection?.stop()
        mediaProjection = null

        captureThread?.quitSafely()
        captureThread = null

        runCatching {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        }
        wakeLock = null

        notificarEstado()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        encerrarTudo()
        super.onDestroy()
    }
}
