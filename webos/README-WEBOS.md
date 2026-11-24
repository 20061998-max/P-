# TelaCast TV — LG webOS

Este pacote instala o atalho/aplicativo **TelaCast TV** diretamente no iniciador de aplicativos da Smart TV LG (webOS 4.0+).

## Opção 1: Atalho direto pela TV LG (sem PC)
1. Abra o navegador da Smart TV LG e acesse a URL da plataforma TelaCast.
2. No menu do navegador (`⋮` ou ícone de estrela/mais), selecione **Adicionar à página inicial** / **Fixar nos aplicativos**.
3. Abra o ícone fixado para executar o visualizador de jogos e espelhamento fora da barra do navegador.

## Opção 2: Empacotar e instalar via LG webOS CLI (`ares-package`)
1. Instale o CLI oficial **LG webOS TV CLI** (`@webosose/ares-cli`) e ative o **Developer Mode** na sua TV LG.
2. Empacote esta pasta `/webos`:
   ```bash
   ares-package webos/
   ares-install --device sua-tv com.telacast.tv_1.0.0_all.ipk
   ```
3. O aplicativo **TelaCast TV** aparecerá na barra inicial da TV LG com suporte completo ao controle remoto (setas, OK e botão Voltar).
