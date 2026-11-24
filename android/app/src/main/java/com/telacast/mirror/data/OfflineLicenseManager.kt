package com.telacast.mirror.data

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings
import android.util.Base64
import com.telacast.mirror.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.math.ceil

data class OfflineLicenseState(
    val deviceCode: String,
    val ativo: Boolean,
    val plano: String? = null,
    val expiraEmMillis: Long = 0L,
    val expiraEmTexto: String? = null,
    val diasRestantes: Int = 0,
    val motivo: String? = null
)

object OfflineLicenseManager {

    private const val PREFS_NAME = "telacast_offline_license"
    private const val KEY_DEVICE_CODE = "device_code"
    private const val KEY_ACTIVATION_KEY = "activation_key"
    private const val KEY_PUBLIC_SPKI = "public_spki_b64"
    private const val KEY_ADMIN_WHATSAPP = "admin_whatsapp"

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .build()

    @SuppressLint("HardwareIds")
    fun getOrCreateDeviceCode(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val saved = prefs.getString(KEY_DEVICE_CODE, null)
        if (!saved.isNullOrBlank() && Regex("^TC-[A-Z0-9]{4}-[A-Z0-9]{4}$").matches(saved)) {
            return saved
        }

        val androidId = runCatching {
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        }.getOrNull().orEmpty()

        val seed = if (androidId.isNotBlank() && androidId != "9774d56d682e549c") {
            "telacast:$androidId"
        } else {
            "telacast:${UUID.randomUUID()}"
        }

        val digest = MessageDigest.getInstance("SHA-256").digest(seed.toByteArray(Charsets.UTF_8))
        val hex = digest.take(4).joinToString("") { "%02X".format(it) }
        val code = "TC-${hex.substring(0, 4)}-${hex.substring(4, 8)}"
        prefs.edit().putString(KEY_DEVICE_CODE, code).apply()
        return code
    }

    suspend fun syncPublicKeyIfNeeded(context: Context): String? = withContext(Dispatchers.IO) {
        val baked = BuildConfig.LICENSE_PUBLIC_KEY.trim()
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val cached = prefs.getString(KEY_PUBLIC_SPKI, null)?.trim()

        val apiBase = BuildConfig.API_BASE_URL.trimEnd('/')
        if (apiBase.startsWith("http") && !apiBase.contains("seu-dominio.com")) {
            runCatching {
                val request = Request.Builder()
                    .url("$apiBase/api/licenca/chave-publica")
                    .get()
                    .build()
                httpClient.newCall(request).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val body = resp.body?.string().orEmpty()
                        val json = JSONObject(body)
                        val spki = json.optString("publicKeySpkiBase64", "").trim()
                        val wa = json.optString("whatsappNumber", "").replace(Regex("\\D"), "")
                        val editor = prefs.edit()
                        if (spki.isNotBlank()) editor.putString(KEY_PUBLIC_SPKI, spki)
                        if (wa.isNotBlank()) editor.putString(KEY_ADMIN_WHATSAPP, wa)
                        editor.apply()
                        if (baked.isBlank() && spki.isNotBlank()) {
                            return@withContext spki
                        }
                    }
                }
            }
        }
        if (baked.isNotBlank()) baked else cached?.takeIf { it.isNotBlank() }
    }

    fun getAdminWhatsapp(context: Context): String {
        val baked = BuildConfig.ADMIN_WHATSAPP.replace(Regex("\\D"), "")
        if (baked.isNotBlank()) return baked
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_ADMIN_WHATSAPP, null)?.replace(Regex("\\D"), "").orEmpty()
    }

    fun getSavedActivationKey(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_ACTIVATION_KEY, null)?.trim()?.takeIf { it.isNotBlank() }
    }

    fun getLiveWebSocketUrl(): String? {
        val apiBase = BuildConfig.API_BASE_URL.trim().trimEnd('/')
        if (!apiBase.startsWith("http") || apiBase.contains("seu-dominio.com")) return null
        val wsBase = when {
            apiBase.startsWith("https://") -> "wss://${apiBase.removePrefix("https://")}"
            apiBase.startsWith("http://") -> "ws://${apiBase.removePrefix("http://")}"
            else -> return null
        }
        return "$wsBase/ws/live"
    }

    fun getAvailablePublicKeySpkiCandidates(context: Context): List<String> {
        val baked = BuildConfig.LICENSE_PUBLIC_KEY.trim()
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val cached = prefs.getString(KEY_PUBLIC_SPKI, null)?.trim().orEmpty()
        return listOf(baked, cached).filter { it.isNotBlank() }.distinct()
    }

    fun getAvailablePublicKeySpki(context: Context): String? {
        return getAvailablePublicKeySpkiCandidates(context).firstOrNull()
    }

    fun verifyAndSaveKey(context: Context, rawKey: String): OfflineLicenseState {
        val state = verifyKey(context, rawKey)
        if (state.ativo) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_ACTIVATION_KEY, rawKey.trim()).apply()
        }
        return state
    }

    fun getSavedLicenseState(context: Context): OfflineLicenseState {
        val deviceCode = getOrCreateDeviceCode(context)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedKey = prefs.getString(KEY_ACTIVATION_KEY, null)?.trim()
        if (savedKey.isNullOrBlank()) {
            return OfflineLicenseState(
                deviceCode = deviceCode,
                ativo = false,
                motivo = "Nenhuma chave offline ativada neste aparelho."
            )
        }
        return verifyKey(context, savedKey)
    }

    fun clearLicense(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_ACTIVATION_KEY).apply()
    }

    fun verifyKey(context: Context, rawKey: String): OfflineLicenseState {
        val deviceCode = getOrCreateDeviceCode(context)
        val cleanKey = rawKey.trim()
        val parts = cleanKey.split(".")
        if (parts.size != 3 || parts[0] != "TC1") {
            return OfflineLicenseState(
                deviceCode = deviceCode,
                ativo = false,
                motivo = "Formato de chave inválido (esperado TC1.xxx.yyy)."
            )
        }

        val spkiCandidates = getAvailablePublicKeySpkiCandidates(context)
        if (spkiCandidates.isEmpty()) {
            return OfflineLicenseState(
                deviceCode = deviceCode,
                ativo = false,
                motivo = "Chave pública não configurada neste APK. Informe LICENSE_PUBLIC_KEY ou conecte uma vez ao servidor."
            )
        }

        return runCatching {
            val payload = decodeBase64Url(parts[1])
            val sigP1363 = decodeBase64Url(parts[2])
            if (payload.size != 14 || sigP1363.size != 64) {
                return@runCatching OfflineLicenseState(
                    deviceCode = deviceCode,
                    ativo = false,
                    motivo = "Estrutura da chave inválida."
                )
            }

            val sigDer = ieeeP1363ToDer(sigP1363)
            val signatureMatched = spkiCandidates.any { candidate ->
                runCatching {
                    val spkiBytes = Base64.decode(candidate, Base64.DEFAULT)
                    val publicKey = KeyFactory.getInstance("EC")
                        .generatePublic(X509EncodedKeySpec(spkiBytes))
                    val verifier = Signature.getInstance("SHA256withECDSA")
                    verifier.initVerify(publicKey)
                    verifier.update(payload)
                    verifier.verify(sigDer)
                }.getOrDefault(false)
            }
            if (!signatureMatched) {
                return@runCatching OfflineLicenseState(
                    deviceCode = deviceCode,
                    ativo = false,
                    motivo = "Assinatura criptográfica inválida."
                )
            }

            val normalizedCode = deviceCode.trim().uppercase(Locale.US)
                .replace(Regex("[^A-Z0-9-]"), "")
            val codeDigest = MessageDigest.getInstance("SHA-256")
                .digest(normalizedCode.toByteArray(Charsets.UTF_8))

            for (i in 0 until 4) {
                if (payload[i] != codeDigest[i]) {
                    return@runCatching OfflineLicenseState(
                        deviceCode = deviceCode,
                        ativo = false,
                        motivo = "Esta chave pertence a outro celular/TV."
                    )
                }
            }

            val buf = ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN)
            val expSec = buf.getInt(4).toLong() and 0xFFFFFFFFL
            val planCode = payload[8].toInt() and 0xFF
            val plano = when (planCode) {
                1 -> "1 Mês"
                2 -> "3 Meses"
                3 -> "6 Meses"
                4 -> "1 Ano"
                5 -> "Mensal Básico"
                6 -> "Mensal Pro"
                7 -> "Mensal Estúdio"
                8 -> "Outros"
                else -> "1 Mês"
            }

            val expMs = expSec * 1000L
            val nowMs = System.currentTimeMillis()
            val formattedDate = SimpleDateFormat("dd/MM/yyyy", Locale("pt", "BR"))
                .format(Date(expMs))

            if (expMs <= nowMs) {
                return@runCatching OfflineLicenseState(
                    deviceCode = deviceCode,
                    ativo = false,
                    plano = plano,
                    expiraEmMillis = expMs,
                    expiraEmTexto = formattedDate,
                    diasRestantes = 0,
                    motivo = "Assinatura offline vencida em $formattedDate."
                )
            }

            val diasRestantes = ceil((expMs - nowMs).toDouble() / (1000.0 * 60.0 * 60.0 * 24.0))
                .toInt()
                .coerceAtLeast(1)

            OfflineLicenseState(
                deviceCode = deviceCode,
                ativo = true,
                plano = plano,
                expiraEmMillis = expMs,
                expiraEmTexto = formattedDate,
                diasRestantes = diasRestantes
            )
        }.getOrElse {
            OfflineLicenseState(
                deviceCode = deviceCode,
                ativo = false,
                motivo = "Não foi possível validar a chave offline."
            )
        }
    }

    private fun decodeBase64Url(value: String): ByteArray {
        val flags = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        return Base64.decode(value, flags)
    }

    /**
     * Converte assinatura ECDSA P-256 de 64 bytes IEEE P1363 (r || s) para ASN.1 DER
     * exigido por java.security.Signature("SHA256withECDSA").
     */
    private fun ieeeP1363ToDer(p1363: ByteArray): ByteArray {
        val r = p1363.copyOfRange(0, 32)
        val s = p1363.copyOfRange(32, 64)
        val derR = encodeDerInt(r)
        val derS = encodeDerInt(s)

        val totalLen = derR.size + derS.size
        val out = ByteArrayOutputStream()
        out.write(0x30)
        if (totalLen >= 0x80) {
            out.write(0x81)
        }
        out.write(totalLen)
        out.write(derR)
        out.write(derS)
        return out.toByteArray()
    }

    private fun encodeDerInt(raw: ByteArray): ByteArray {
        var start = 0
        while (start < raw.size - 1 && raw[start].toInt() == 0) {
            start++
        }
        val trimmed = raw.copyOfRange(start, raw.size)
        val needsLeadingZero = (trimmed[0].toInt() and 0x80) != 0
        val out = ByteArrayOutputStream()
        out.write(0x02)
        out.write(trimmed.size + if (needsLeadingZero) 1 else 0)
        if (needsLeadingZero) {
            out.write(0x00)
        }
        out.write(trimmed)
        return out.toByteArray()
    }
}
