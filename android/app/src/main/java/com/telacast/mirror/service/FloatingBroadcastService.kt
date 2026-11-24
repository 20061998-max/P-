package com.telacast.mirror.service

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import com.telacast.mirror.ui.QuickProjectionActivity
import kotlin.math.abs

class FloatingBroadcastService : Service() {

    companion object {
        const val ACTION_SHOW = "com.telacast.mirror.FLOATING_SHOW"
        const val ACTION_HIDE = "com.telacast.mirror.FLOATING_HIDE"
        const val ACTION_REFRESH = "com.telacast.mirror.FLOATING_REFRESH"

        @Volatile
        var isOverlayVisible = false
            private set

        fun refreshOverlay(context: Context) {
            if (!isOverlayVisible) return
            val intent = Intent(context, FloatingBroadcastService::class.java).apply {
                action = ACTION_REFRESH
            }
            runCatching { context.startService(intent) }
        }
    }

    private var windowManager: WindowManager? = null
    private var overlayContainer: LinearLayout? = null
    private var actionButton: TextView? = null
    private var closeButton: TextView? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private val timerHandler = Handler(Looper.getMainLooper())
    private val timerTickRunnable = object : Runnable {
        override fun run() {
            if (ScreenMirrorService.isRunning && isOverlayVisible) {
                renderizarTextoOverlay()
                timerHandler.postDelayed(this, 1000L)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_HIDE -> {
                removerOverlay()
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_REFRESH -> {
                atualizarAparenciaBotao()
                return START_STICKY
            }

            else -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                mostrarOverlay()
                atualizarAparenciaBotao()
                return START_STICKY
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun mostrarOverlay() {
        if (overlayContainer != null) return

        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = wm

        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(20)
            y = dp(180)
        }
        layoutParams = params

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(10), dp(8))
            elevation = dp(10).toFloat()
            background = GradientDrawable().apply {
                cornerRadius = dp(999).toFloat()
                setColor(Color.parseColor("#C8102E"))
                setStroke(dp(1), Color.parseColor("#66FFFFFF"))
            }
        }

        val btnMain = TextView(this).apply {
            text = "INICIAR TRANSMISSÃO"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(4), dp(2), dp(8), dp(2))
        }

        val btnClose = TextView(this).apply {
            text = "×"
            setTextColor(Color.parseColor("#E4E4E7"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(8), dp(0), dp(4), dp(0))
        }

        btnClose.setOnClickListener {
            removerOverlay()
            stopSelf()
        }

        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var moved = false

        val dragAndTapListener = View.OnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    moved = false
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()
                    if (abs(dx) > dp(6) || abs(dy) > dp(6)) {
                        moved = true
                    }
                    params.x = initialX + dx
                    params.y = initialY + dy
                    runCatching { wm.updateViewLayout(container, params) }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    if (!moved) {
                        aoTocarBotaoFlutuante()
                    }
                    true
                }

                else -> false
            }
        }

        container.setOnTouchListener(dragAndTapListener)
        btnMain.setOnTouchListener(dragAndTapListener)

        container.addView(btnMain)
        container.addView(btnClose)

        overlayContainer = container
        actionButton = btnMain
        closeButton = btnClose

        wm.addView(container, params)
        isOverlayVisible = true
    }

    private fun aoTocarBotaoFlutuante() {
        if (ScreenMirrorService.isRunning) {
            val stopIntent = Intent(this, ScreenMirrorService::class.java).apply {
                action = ScreenMirrorService.ACTION_STOP
            }
            startService(stopIntent)
            atualizarAparenciaBotao()
            return
        }

        // Captura diretamente o app/tela que o administrador estiver usando agora (dentro ou fora do app)
        val launchIntent = Intent(this, QuickProjectionActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
            putExtra(QuickProjectionActivity.EXTRA_DIRECT_SCREEN, true)
        }
        startActivity(launchIntent)
    }

    private fun formatarDuracao(startedAt: Long): String {
        if (startedAt <= 0L) return "00:00"
        val elapsedSec = ((System.currentTimeMillis() - startedAt) / 1000L).coerceAtLeast(0L)
        val mins = elapsedSec / 60L
        val secs = elapsedSec % 60L
        return String.format("%02d:%02d", mins, secs)
    }

    private fun renderizarTextoOverlay() {
        val container = overlayContainer ?: return
        val btn = actionButton ?: return
        val streaming = ScreenMirrorService.isRunning
        val bg = container.background as? GradientDrawable

        if (streaming) {
            val timer = formatarDuracao(ScreenMirrorService.startedAtMillis)
            btn.text = if (ScreenMirrorService.isOnlineConnected) {
                "● AO VIVO $timer · PARAR"
            } else {
                "● REC $timer · PARAR"
            }
            bg?.setColor(Color.parseColor("#059669"))
        } else {
            btn.text = "INICIAR TRANSMISSÃO"
            bg?.setColor(Color.parseColor("#C8102E"))
        }
    }

    private fun atualizarAparenciaBotao() {
        val container = overlayContainer ?: return
        container.post {
            renderizarTextoOverlay()
            timerHandler.removeCallbacks(timerTickRunnable)
            if (ScreenMirrorService.isRunning && isOverlayVisible) {
                timerHandler.postDelayed(timerTickRunnable, 1000L)
            }
        }
    }

    private fun removerOverlay() {
        timerHandler.removeCallbacks(timerTickRunnable)
        val container = overlayContainer
        overlayContainer = null
        actionButton = null
        closeButton = null
        isOverlayVisible = false
        if (container != null) {
            runCatching { windowManager?.removeView(container) }
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    override fun onDestroy() {
        removerOverlay()
        super.onDestroy()
    }
}
