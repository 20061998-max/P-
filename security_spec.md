# Security Spec — Jogos do Mengão (Firestore Rules)

## 1. Data Invariants
1. Somente o administrador autenticado via Google com e-mail verificado (`josuelroque05052020@gmail.com` ou documento em `/admins/{uid}`) pode criar, editar ou excluir planos em `/plans/{planId}` e alterar `/settings/public` (WhatsApp, Pix e trava anti-retransmissão).
2. Visitantes da vitrine pública podem ler `/settings/public` e listar planos ativos (`/plans` onde `active == true`), sem qualquer dado pessoal (PII).
3. O histórico `/offline_licenses/{licenseId}` só pode ser lido, listado e gravado pelo administrador autenticado, com `createdByUid == request.auth.uid` e `createdAt == request.time`.
4. Toda string possui validação explícita de tamanho máximo, listas possuem limite de itens e nenhum campo fantasma (`shadow field`) é aceito em criações ou atualizações.

## 2. Dirty Dozen Payloads (Devem retornar PERMISSION_DENIED)
1. Visitante sem autenticação tentando alterar `/settings/public` (`pixKey`).
2. Usuário comum com Google autenticado (`outro@gmail.com`) tentando criar plano em `/plans/hack`.
3. Usuário com `email == josuelroque05052020@gmail.com` mas `email_verified == false` tentando editar `/settings/public`.
4. Admin tentando enviar campo extra não permitido (`isSuperAdmin: true`) em `/plans/p1` ("Shadow Update").
5. Admin tentando enviar `days: -10` ou `days: 99999` em `/plans/p1`.
6. Usuário tentando listar `/settings` inteira via `list` query.
7. Usuário não-admin tentando listar `/offline_licenses`.
8. Admin tentando gravar `createdByUid` diferente de `request.auth.uid` em `/offline_licenses/l1`.
9. Admin tentando gravar `updatedAt` com timestamp forjado diferente de `request.time`.
10. Usuário tentando criar documento com ID inválido contendo `/` ou >128 caracteres.
11. Usuário tentando enviar array `features` com mais de 8 elementos em `/plans/p1`.
12. Usuário tentando ler coleção inexistente `/users/123` (bloqueado pelo catch-all).
