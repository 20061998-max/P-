package com.telacast.mirror.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.telacast.mirror.BuildConfig
import com.telacast.mirror.service.ScreenMirrorService

class QuickProjectionActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_DIRECT_SCREEN = "extra_direct_screen"
        const val EXTRA_TARGET_PACKAGE = "extra_target_package"
    }

    private var directScreen = true
    private var targetPackage = ""

    private val captureLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK && result.data != null) {
                val prefs = getSharedPreferences(ScreenMirrorService.PREFS_BROADCASTER, Context.MODE_PRIVATE)
                val serverUrl = prefs.getString(ScreenMirrorService.KEY_SERVER_URL, null)
                    ?.trim()
                    ?.takeIf { it.isNotBlank() }
                    ?: BuildConfig.API_BASE_URL.trim()
                val serviceIntent = Intent(this, ScreenMirrorService::class.java).apply {
                    action = ScreenMirrorService.ACTION_START
                    putExtra(ScreenMirrorService.EXTRA_RESULT_CODE, result.resultCode)
                    putExtra(ScreenMirrorService.EXTRA_RESULT_DATA, result.data)
                    putExtra(ScreenMirrorService.EXTRA_SERVER_URL, serverUrl)
                    putExtra(
                        ScreenMirrorService.EXTRA_ADMIN_TOKEN,
                        prefs.getString(ScreenMirrorService.KEY_ADMIN_TOKEN, "")
                    )
                    putExtra(
                        ScreenMirrorService.EXTRA_BROADCAST_TITLE,
                        prefs.getString(ScreenMirrorService.KEY_BROADCAST_TITLE, "Jogos do Mengão · Ao Vivo")
                    )
                    putExtra(
                        ScreenMirrorService.EXTRA_SOURCE_APP,
                        if (directScreen) "Tela Direta do Celular"
                        else prefs.getString(ScreenMirrorService.KEY_SOURCE_APP, "App Nativo")
                    )
                }
                ContextCompat.startForegroundService(this, serviceIntent)
                Toast.makeText(
                    this,
                    "Transmitindo ao vivo para o site e usuários!",
                    Toast.LENGTH_SHORT
                ).show()

                if (!directScreen && targetPackage.isNotBlank()) {
                    val appLaunch = packageManager.getLaunchIntentForPackage(targetPackage)
                    if (appLaunch != null) {
                        appLaunch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(appLaunch)
                    }
                }
            } else {
                Toast.makeText(this, "Permissão de transmissão cancelada.", Toast.LENGTH_SHORT).show()
            }
            finish()
            overridePendingTransition(0, 0)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        directScreen = intent.getBooleanExtra(EXTRA_DIRECT_SCREEN, true)
        targetPackage = intent.getStringExtra(EXTRA_TARGET_PACKAGE).orEmpty()

        val projectionManager =
            getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
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
        captureLauncher.launch(captureIntent)
    }
}
