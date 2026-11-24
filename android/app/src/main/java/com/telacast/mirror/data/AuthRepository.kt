package com.telacast.mirror.data

import com.telacast.mirror.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class SubscriptionStatus(
    val ativo: Boolean,
    val statusAssinatura: String,
    val plano: String?,
    val expiraEm: String?,
    val nome: String?
)

sealed class LoginOutcome {
    data class Authorized(val accessToken: String, val subscription: SubscriptionStatus) : LoginOutcome()
    data class SubscriptionRequired(val subscription: SubscriptionStatus) : LoginOutcome()
    data class Error(val message: String) : LoginOutcome()
}

class AuthRepository {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun loginAndVerifySubscription(email: String, password: String): LoginOutcome =
        withContext(Dispatchers.IO) {
            try {
                val baseUrl = BuildConfig.API_BASE_URL.trim().trimEnd('/')
                if (!baseUrl.startsWith("http") || baseUrl.contains("seu-dominio.com")) {
                    return@withContext LoginOutcome.Error(
                        "Servidor não configurado neste APK. Use a chave offline acima."
                    )
                }

                val authPayload = JSONObject().apply {
                    put("email", email.trim())
                    put("password", password)
                }

                val authReq = Request.Builder()
                    .url("$baseUrl/api/auth/login")
                    .addHeader("Content-Type", "application/json")
                    .post(authPayload.toString().toRequestBody(jsonMediaType))
                    .build()

                val accessToken = client.newCall(authReq).execute().use { res ->
                    val bodyStr = res.body?.string().orEmpty()
                    if (!res.isSuccessful) {
                        val errMsg = runCatching {
                            val json = JSONObject(bodyStr)
                            json.optString("erro", "")
                                .takeIf { it.isNotBlank() }
                                ?: json.optString("error_description", "E-mail ou senha inválidos.")
                        }.getOrDefault("E-mail ou senha inválidos.")
                        return@withContext LoginOutcome.Error(errMsg)
                    }
                    JSONObject(bodyStr).getString("token")
                }

                val verifyReq = Request.Builder()
                    .url("$baseUrl/api/verificar-assinatura")
                    .addHeader("Authorization", "Bearer $accessToken")
                    .get()
                    .build()

                client.newCall(verifyReq).execute().use { res ->
                    val bodyStr = res.body?.string().orEmpty()
                    if (!res.isSuccessful) {
                        return@withContext LoginOutcome.Error(
                            "Não foi possível validar sua assinatura (${res.code})."
                        )
                    }

                    val json = JSONObject(bodyStr)
                    val status = SubscriptionStatus(
                        ativo = json.optBoolean("ativo", false),
                        statusAssinatura = json.optString("status_assinatura", "pendente"),
                        plano = json.optString("plano", "").takeIf { it.isNotBlank() && it != "null" },
                        expiraEm = json.optString("expira_em", "").takeIf { it.isNotBlank() && it != "null" },
                        nome = json.optString("nome", "").takeIf { it.isNotBlank() && it != "null" }
                    )

                    if (status.ativo) {
                        LoginOutcome.Authorized(accessToken, status)
                    } else {
                        LoginOutcome.SubscriptionRequired(status)
                    }
                }
            } catch (e: Exception) {
                LoginOutcome.Error(e.localizedMessage ?: "Erro de conexão com o servidor.")
            }
        }
}
