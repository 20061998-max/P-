package com.telacast.mirror.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.telacast.mirror.BuildConfig
import com.telacast.mirror.service.ScreenMirrorService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

object AppUpdateManager {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    @Volatile
    private var promptedThisSession = false

    private fun resolveServerUrl(context: Context): String {
        val prefs = context.getSharedPreferences(
            ScreenMirrorService.PREFS_BROADCASTER,
            Context.MODE_PRIVATE
        )
        val saved = prefs.getString(ScreenMirrorService.KEY_SERVER_URL, null)
            ?.trim()
            ?.trimEnd('/')
        if (!saved.isNullOrBlank() && saved.startsWith("http")) {
            return saved
        }
        return BuildConfig.API_BASE_URL.trim().trimEnd('/')
    }

    private fun parseIsoUtcMillis(raw: String?): Long {
        if (raw.isNullOrBlank() || raw.length < 19) return 0L
        return runCatching {
            val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            fmt.parse(raw.substring(0, 19))?.time ?: 0L
        }.getOrDefault(0L)
    }

    fun syncConfigOnly(activity: AppCompatActivity) {
        val baseUrl = resolveServerUrl(activity)
        if (!baseUrl.startsWith("http")) return

        activity.lifecycleScope.launch(Dispatchers.IO) {
            runCatching {
                OfflineLicenseManager.syncPublicKeyIfNeeded(activity.applicationContext)
                val req = Request.Builder()
                    .url("$baseUrl/api/licenca/chave-publica")
                    .get()
                    .build()
                httpClient.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val json = JSONObject(resp.body?.string().orEmpty())
                        if (json.has("tvOnlyAntiRetransmission")) {
                            ScreenMirrorService.onlyAllowTvReceivers =
                                json.optBoolean("tvOnlyAntiRetransmission", true)
                        }
                    }
                }
            }
        }
    }

    fun syncAndCheckForUpdates(activity: AppCompatActivity) {
        val baseUrl = resolveServerUrl(activity)
        if (!baseUrl.startsWith("http")) return

        activity.lifecycleScope.launch(Dispatchers.IO) {
            syncConfigSyncInternal(activity.applicationContext, baseUrl)

            if (promptedThisSession) return@launch

            val updateInfo = runCatching {
                val req = Request.Builder()
                    .url("$baseUrl/api/apk-status")
                    .header("Cache-Control", "no-store")
                    .get()
                    .build()
                httpClient.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@runCatching null
                    val json = JSONObject(resp.body?.string().orEmpty())
                    val hasApk = json.optBoolean("hasCompiledApk", false)
                    val updatedAt = json.optString("updatedAt", "")
                    val remoteMs = parseIsoUtcMillis(updatedAt)
                    if (!hasApk || remoteMs <= 0L) null else remoteMs
                }
            }.getOrNull() ?: return@launch

            val installedAtMs = runCatching {
                activity.packageManager.getPackageInfo(activity.packageName, 0).lastUpdateTime
            }.getOrDefault(0L)

            // Oferece atualização automática quando houver APK mais recente no site/GitHub
            if (installedAtMs > 0L && updateInfo > installedAtMs + 120_000L) {
                promptedThisSession = true
                withContext(Dispatchers.Main) {
                    if (activity.isFinishing || activity.isDestroyed) return@withContext
                    AlertDialog.Builder(activity)
                        .setTitle("Atualização disponível")
                        .setMessage("O administrador publicou uma nova atualização do Jogos do Mengão. Deseja atualizar automaticamente agora?")
                        .setPositiveButton("Atualizar Agora") { _, _ ->
                            downloadAndInstallApk(activity, baseUrl)
                        }
                        .setNegativeButton("Depois", null)
                        .show()
                }
            }
        }
    }

    private suspend fun syncConfigSyncInternal(context: Context, baseUrl: String) {
        runCatching {
            OfflineLicenseManager.syncPublicKeyIfNeeded(context)
            val req = Request.Builder()
                .url("$baseUrl/api/licenca/chave-publica")
                .get()
                .build()
            httpClient.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) {
                    val json = JSONObject(resp.body?.string().orEmpty())
                    if (json.has("tvOnlyAntiRetransmission")) {
                        ScreenMirrorService.onlyAllowTvReceivers =
                            json.optBoolean("tvOnlyAntiRetransmission", true)
                    }
                }
            }
        }
    }

    private fun downloadAndInstallApk(activity: AppCompatActivity, baseUrl: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            Toast.makeText(
                activity,
                "Autorize 'Instalar apps desconhecidos' para atualizar automaticamente.",
                Toast.LENGTH_LONG
            ).show()
            runCatching {
                val permIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                )
                activity.startActivity(permIntent)
            }
            return
        }

        Toast.makeText(activity, "Baixando atualização automática...", Toast.LENGTH_SHORT).show()

        activity.lifecycleScope.launch(Dispatchers.IO) {
            val downloadedFile = runCatching {
                val updatesDir = File(activity.cacheDir, "updates").apply { mkdirs() }
                val targetFile = File(updatesDir, "JogosDoMengao.apk")
                val req = Request.Builder().url("$baseUrl/api/download-apk").get().build()
                httpClient.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) {
                        throw IllegalStateException("HTTP ${resp.code}")
                    }
                    val bodyStream = resp.body?.byteStream()
                        ?: throw IllegalStateException("Resposta vazia")
                    FileOutputStream(targetFile).use { out ->
                        bodyStream.copyTo(out)
                    }
                }
                targetFile
            }.getOrNull()

            withContext(Dispatchers.Main) {
                if (activity.isFinishing || activity.isDestroyed) return@withContext
                if (downloadedFile != null && downloadedFile.exists() && downloadedFile.length() > 1024L) {
                    val apkUri = runCatching {
                        FileProvider.getUriForFile(
                            activity,
                            "${activity.packageName}.fileprovider",
                            downloadedFile
                        )
                    }.getOrNull()

                    if (apkUri != null) {
                        val installIntent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(apkUri, "application/vnd.android.package-archive")
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        runCatching {
                            activity.startActivity(installIntent)
                            return@withContext
                        }
                    }
                }

                // Fallback seguro para navegador caso a instalação direta seja bloqueada pelo sistema
                val browserIntent = Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("$baseUrl/api/download-apk")
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { activity.startActivity(browserIntent) }
            }
        }
    }
}
