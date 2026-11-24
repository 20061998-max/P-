# Jogos do Mengão — App Oficial, Vitrine SaaS & Smart TV

Plataforma completa com vitrine pública, painel administrativo Google/Firebase + Senha Admin, geração de chaves criptográficas offline ECDSA P-256 por aparelho, transmissão ao vivo via WebSocket (`/ws/live`), abertura direta de apps nativos no celular e pacotes para **Android**, **Android TV**, **LG webOS** e **navegadores de Smart TVs**.

---

## Projeto Firebase & Repositório GitHub Original

- **Repositório GitHub**: `https://github.com/20061998-max/App-jogos-do-meng-o-v2`
- **Projeto Firebase**: `ageless-catcher-t7cdj`
- **Firestore Database ID**: `ai-studio-telacast-fa5620eb-bbb2-4868-8fdd-1bb1fbc4004d`
- **Administrador autorizado**: `josuelroque05052020@gmail.com`

---

## Estrutura do Repositório

- `src/` — Frontend React + Vite + Tailwind + PWA (`start_url: /?mode=app`) com ajuste automático de tela (`clamp()` + `100dvh`), vitrine apenas com números das camisas, painel Admin com **Transmitir Ao Vivo** e botão para abrir os apps nativos no celular.
- `server.ts` & `server/` — Servidor Express + WebSocket (`/ws/live`), proteção OWASP (`server/security.ts`), API de licenciamento offline ECDSA P-256, telemetria de aparelhos, auto-publicação e download (`/api/download-apk`, `/api/download-webos`, `/api/apk-status`).
- `android/` — Aplicativo nativo Kotlin compatível com celulares Android e Android TV (`LEANBACK_LAUNCHER`), permissões para listar e abrir apps nativos (`QUERY_ALL_PACKAGES`, `SYSTEM_ALERT_WINDOW`, `WAKE_LOCK`, `RECORD_AUDIO`, `<queries>`), proteção `FLAG_SECURE` e receptor MJPEG/offline.
- `webos/` — Aplicativo para Smart TVs LG webOS com receptor `/ws/live` + Wi-Fi local e controle remoto LG (`461`).
- `Dockerfile` & `.dockerignore` — Container de produção pronto para Cloud Run, Render, Railway ou Fly.io.
- `.github/workflows/ci-and-apk.yml` — Pipeline completo de CI, build do `.apk`, release automática e auto-deploy.
- `.github/dependabot.yml` — Atualizações automáticas semanais de segurança (npm, Gradle e GitHub Actions).
- `firestore.rules`, `firebase.json`, `.firebaserc` — Regras de segurança do Cloud Firestore validadas com ESLint.

---

## Como Enviar para o GitHub (Primeiro Push)

Extraia o projeto em uma pasta local e execute:

```bash
git init -b main
git remote add origin https://github.com/20061998-max/App-jogos-do-meng-o-v2.git
git add .
git commit -m "Versão completa Jogos do Mengão: vitrine, permissões nativas Android, segurança OWASP e auto-deploy"
git push -u origin main --force
```

*(Use `--force` apenas se quiser substituir o `telacast.zip` antigo da raiz pelo projeto completo descompactado.)*

---

## Automações e Auto-Deploy no GitHub Actions

A cada `git push` na branch `main`:

1. **Validação Completa (`web-ci`)**:
   - Executa `npm install`, `npm run lint` (`tsc --noEmit`), `npx eslint firestore.rules` e `npm run build`.
2. **Compilação Nativa (`build-android-apk`)**:
   - Compila o aplicativo Android/Android TV (`JogosDoMengao.apk`) e empacota o app LG webOS (`JogosDoMengao-LG-webOS.zip`).
3. **GitHub Release Automática (`publish-release`)**:
   - Publica automaticamente na página **Releases (`latest`)** os arquivos **`JogosDoMengao.apk`** e **`JogosDoMengao-LG-webOS.zip`** prontos para download direto nas Smart TVs e celulares.
4. **Auto-Deploy em Produção (`auto-deploy`)**:
   - **Firebase Firestore Rules**: se você cadastrar o Secret `FIREBASE_SERVICE_ACCOUNT`, atualiza as regras do projeto `ageless-catcher-t7cdj` automaticamente.
   - **Google Cloud Run**: se cadastrar a Variable `GCP_PROJECT_ID` e o Secret `GCP_SA_KEY`, faz build do `Dockerfile` e publica o servidor automaticamente com `APK_DOWNLOAD_URL` apontando para o `.apk` da Release `latest`.
   - **Render / Railway / Host Customizado**: se cadastrar o Secret `DEPLOY_WEBHOOK_URL`, dispara o deploy automático assim que os testes e o build do APK concluírem.
5. **Dependabot**: verifica atualizações de segurança semanais para npm, Android Gradle e GitHub Actions.

---

## Variáveis e Segredos Recomendados (Produção)

Configure no seu provedor (Cloud Run / Render / Railway) e em **Settings -> Secrets and variables -> Actions** no GitHub:

| Nome | Tipo | Função |
| --- | --- | --- |
| `ADMIN_PASSCODE` | Secret | Define a senha do painel Admin no servidor (`process.env`) |
| `JWT_SECRET` | Secret | Chave fixa de assinatura das sessões Admin |
| `APP_URL` | Env/Var | Domínio público do site (ex.: `https://jogosdomengao.com`) |
| `APK_DOWNLOAD_URL` | Env/Var | Link direto do `.apk` da Release `latest` do GitHub |
| `GCP_PROJECT_ID` | Action Variable | ID do projeto Google Cloud para deploy automático no Cloud Run |
| `GCP_SA_KEY` | Action Secret | Chave JSON da Service Account GCP |
| `FIREBASE_SERVICE_ACCOUNT` | Action Secret | Chave JSON para atualizar `firestore.rules` automaticamente |
| `DEPLOY_WEBHOOK_URL` | Action Secret | URL de webhook de deploy do Render / Railway |
| `API_BASE_URL` | Action Variable | Domínio embutido no `.apk` compilado pelo Actions |

---

## Como Rodar Localmente

```bash
npm install
npm run build
npm start
```

O servidor inicia na porta `3000` (ou `process.env.PORT`) servindo a vitrine, painel Admin e transmissão ao vivo via WebSocket `/ws/live`.
