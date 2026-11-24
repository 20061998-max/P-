package com.telacast.mirror.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.telacast.mirror.BuildConfig
import com.telacast.mirror.data.AppUpdateManager
import com.telacast.mirror.data.AuthRepository
import com.telacast.mirror.data.LoginOutcome
import com.telacast.mirror.data.OfflineLicenseManager
import com.telacast.mirror.data.OfflineLicenseState
import com.telacast.mirror.databinding.ActivityLoginBinding
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private val authRepository = AuthRepository()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Verifica imediatamente se já há licença offline válida salva no aparelho (funciona sem internet)
        val savedOffline = OfflineLicenseManager.getSavedLicenseState(this)
        if (savedOffline.ativo) {
            abrirPainelPrincipalOffline(savedOffline)
            return
        }

        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val deviceCode = savedOffline.deviceCode
        binding.txtCodigoAparelho.text = deviceCode

        if (!savedOffline.motivo.isNullOrBlank() && savedOffline.expiraEmMillis > 0L) {
            binding.txtErroOffline.text = savedOffline.motivo
            binding.txtErroOffline.visibility = View.VISIBLE
        }

        // Sincroniza configurações do site e verifica atualização automática do APK
        AppUpdateManager.syncAndCheckForUpdates(this)
        lifecycleScope.launch {
            OfflineLicenseManager.syncPublicKeyIfNeeded(this@LoginActivity)
        }

        binding.btnCopiarCodigo.setOnClickListener {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("Código do Aparelho Jogos do Mengão", deviceCode))
            Toast.makeText(this, "Código $deviceCode copiado", Toast.LENGTH_SHORT).show()
        }

        val planosOffline = listOf(
            "1 Mês (30 dias)",
            "3 Meses (90 dias)",
            "6 Meses (180 dias)",
            "1 Ano (365 dias)",
            "Outros (escolher validade)"
        )
        binding.spinnerPlanoOffline.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            planosOffline
        )
        binding.spinnerPlanoOffline.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val isOutros = position == planosOffline.lastIndex
                binding.layoutOutroPrazo.visibility = if (isOutros) View.VISIBLE else View.GONE
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        binding.btnEnviarWhatsapp.setOnClickListener {
            val adminWa = OfflineLicenseManager.getAdminWhatsapp(this)
            val selecionado = binding.spinnerPlanoOffline.selectedItem?.toString() ?: "1 Mês (30 dias)"
            val planoEscolhido = if (selecionado.startsWith("Outros")) {
                val prazo = binding.inputOutroPrazo.text?.toString()?.trim().orEmpty()
                "Outros (Validade desejada: ${if (prazo.isNotBlank()) prazo else "a combinar"})"
            } else {
                selecionado
            }
            val expired = savedOffline.expiraEmMillis > 0L && !savedOffline.ativo
            val msg = if (expired) {
                "Olá! Quero RENOVAR minha assinatura do Jogos do Mengão.\nPlano escolhido: $planoEscolhido\nCódigo do aparelho: $deviceCode\nAguardo o valor para pagamento via WhatsApp."
            } else {
                "Olá! Instalei o app Jogos do Mengão e gostaria da chave de liberação.\nPlano escolhido: $planoEscolhido\nCódigo do aparelho: $deviceCode\nAguardo o valor para pagamento via WhatsApp."
            }
            val encoded = Uri.encode(msg)
            val waUrl = if (adminWa.isNotBlank()) {
                "https://wa.me/$adminWa?text=$encoded"
            } else {
                "https://wa.me/?text=$encoded"
            }
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(waUrl)))
        }

        binding.btnAtivarOffline.setOnClickListener {
            val chave = binding.inputChaveOffline.text?.toString().orEmpty().trim()
            if (chave.isBlank()) {
                mostrarErroOffline("Cole a chave de liberação TC1... gerada pelo administrador.")
                return@setOnClickListener
            }

            binding.txtErroOffline.visibility = View.GONE
            val result = OfflineLicenseManager.verifyAndSaveKey(this, chave)
            if (result.ativo) {
                Toast.makeText(
                    this,
                    "Licença offline ativada por ${result.diasRestantes} dias!",
                    Toast.LENGTH_SHORT
                ).show()
                abrirPainelPrincipalOffline(result)
            } else {
                // Se faltou chave pública local e houver rede agora, sincroniza e valida mais uma vez
                lifecycleScope.launch {
                    OfflineLicenseManager.syncPublicKeyIfNeeded(this@LoginActivity)
                    val retry = OfflineLicenseManager.verifyAndSaveKey(this@LoginActivity, chave)
                    if (retry.ativo) {
                        abrirPainelPrincipalOffline(retry)
                    } else {
                        mostrarErroOffline(retry.motivo ?: "Chave inválida para este aparelho.")
                    }
                }
            }
        }

        binding.btnEntrar.setOnClickListener {
            val email = binding.inputEmail.text?.toString().orEmpty()
            val senha = binding.inputSenha.text?.toString().orEmpty()
            if (email.isBlank() || senha.isBlank()) {
                mostrarErro("Informe seu e-mail e senha.")
                return@setOnClickListener
            }
            autenticarOnline(email, senha)
        }

        binding.btnIrParaAssinatura.setOnClickListener {
            val uri = Uri.parse("${BuildConfig.API_BASE_URL}/")
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
    }

    private fun abrirPainelPrincipalOffline(state: OfflineLicenseState) {
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_USER_NAME, "Aparelho ${state.deviceCode}")
            putExtra(MainActivity.EXTRA_PLAN_NAME, "${state.plano ?: "Mensal Pro"} · ${state.diasRestantes}d offline")
            putExtra(MainActivity.EXTRA_AUTH_MODE, "offline")
        }
        startActivity(intent)
        finish()
    }

    private fun autenticarOnline(email: String, senha: String) {
        setCarregando(true)
        binding.cardAssinaturaInativa.visibility = View.GONE
        binding.txtErro.visibility = View.GONE

        lifecycleScope.launch {
            when (val outcome = authRepository.loginAndVerifySubscription(email, senha)) {
                is LoginOutcome.Authorized -> {
                    setCarregando(false)
                    val intent = Intent(this@LoginActivity, MainActivity::class.java).apply {
                        putExtra(MainActivity.EXTRA_USER_NAME, outcome.subscription.nome ?: email)
                        putExtra(MainActivity.EXTRA_PLAN_NAME, outcome.subscription.plano ?: "Mensal Pro")
                        putExtra(MainActivity.EXTRA_AUTH_MODE, "online")
                        putExtra(MainActivity.EXTRA_AUTH_TOKEN, outcome.accessToken)
                    }
                    startActivity(intent)
                    finish()
                }

                is LoginOutcome.SubscriptionRequired -> {
                    setCarregando(false)
                    binding.cardAssinaturaInativa.visibility = View.VISIBLE
                    binding.txtAvisoAssinatura.text =
                        "Sua assinatura está com status '${outcome.subscription.statusAssinatura}'. Renove no site ou ative uma chave offline acima."
                }

                is LoginOutcome.Error -> {
                    setCarregando(false)
                    mostrarErro(outcome.message)
                }
            }
        }
    }

    private fun setCarregando(loading: Boolean) {
        binding.btnEntrar.isEnabled = !loading
        binding.progressLogin.visibility = if (loading) View.VISIBLE else View.GONE
    }

    private fun mostrarErro(msg: String) {
        binding.txtErro.text = msg
        binding.txtErro.visibility = View.VISIBLE
    }

    private fun mostrarErroOffline(msg: String) {
        binding.txtErroOffline.text = msg
        binding.txtErroOffline.visibility = View.VISIBLE
    }
}
