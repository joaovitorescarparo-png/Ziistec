# ZiisTec — Branding e e-mails de autenticação (Staging)

## Escopo

Esta rodada personaliza identidade visual e experiência de e-mail sem alterar a autoridade de autenticação/RLS. A F11 permanece intacta: convite só é aceito por `zt_accept_invites()` quando a identidade autenticada possui `email_confirmed_at is not null`.

## Fluxos

### Cadastro normal (Owner)
`signUp` → template **Confirm signup** → Supabase Auth confirma o e-mail → login → onboarding cria empresa/owner via RPC.

Assunto versionado: `Confirme seu e-mail para começar na ZiisTec`.

### Convite de técnico/colaborador
Owner grava `company_invites` via RLS → Edge Function `team-invite-email` valida owner ativo e usa `auth.admin.inviteUserByEmail` → template **Invite user** → Supabase Auth confirma o e-mail → login → `zt_accept_invites()` → membership.

O template recebe somente metadados necessários à UX: nome do convidado, nome da empresa, papel textual e id do convite. Não recebe financeiro, custo, margem, fornecedor ou outros dados privados.

Usuários já cadastrados podem não receber o template nativo **Invite user**, porque o Supabase Auth não recria uma conta existente. O convite de banco continua pendente e um usuário já confirmado pode entrar com o mesmo e-mail para que a F11 o aceite. Para notificação transacional universal de usuários já existentes será necessário um provedor de e-mail transacional; não foi criado um segundo sistema de e-mail nesta rodada.

### Recuperação
`resetPasswordForEmail` → template **Reset password** → redirect autorizado → evento `PASSWORD_RECOVERY` → tela `NovaSenha` → `updateUser({ password })`.

## Redirects fail-closed

O frontend só aceita autenticação em hosts explicitamente listados por `supabaseConfig.js`. Para esta branch, o redirect esperado é:

`https://ziistec-git-hardening-v2-staging-js-connect.vercel.app/`

Hosts Vercel aleatórios/únicos não são aceitos. Localhost só é aceito quando o Vite está em modo de desenvolvimento.

## Passos manuais obrigatórios no Supabase hosted — somente Staging

As ferramentas conectadas deste Work não expõem escrita da configuração hosted do Supabase Auth. Portanto, antes da homologação por caixa de entrada, aplicar manualmente no projeto **ZiisTec V2 Staging** (`xadoktssibuuebzzjrhv`):

1. Authentication → URL Configuration.
2. Confirmar que **Site URL** não aponta para localhost. Para esta homologação, usar `https://ziistec-git-hardening-v2-staging-js-connect.vercel.app/`.
3. Adicionar exatamente o mesmo endereço à lista de Redirect URLs se ainda não existir. Não adicionar wildcard para resolver erro de Preview.
4. Authentication → Email Templates.
5. **Confirm signup**: assunto `Confirme seu e-mail para começar na ZiisTec`; conteúdo de `supabase/templates/confirmation.html`.
6. **Invite user**: assunto `{{ .Data.company_name }} convidou você para a ZiisTec`; conteúdo de `supabase/templates/invite.html`.
7. **Reset password**: assunto `Redefina sua senha da ZiisTec`; conteúdo de `supabase/templates/recovery.html`.
8. Security notification **Password changed**, se habilitada no projeto: assunto `Sua senha da ZiisTec foi alterada`; conteúdo de `supabase/templates/password_changed_notification.html`.
9. Não alterar Supabase Production nesta rodada.

Os templates preservam `{{ .ConfirmationURL }}`. Não substituir por URL criada no frontend.

## Logo dos e-mails em Staging

O Preview Vercel está protegido por autenticação, então clientes de e-mail não conseguem buscar uma imagem privada do Preview sem cookie. Temporariamente os templates de Staging usam a cópia HTTPS do asset no repositório público controlado pela ZiisTec:

`https://raw.githubusercontent.com/joaovitorescarparo-png/Ziistec/hardening-v2-staging/public/brand/ziistec-horizontal-light.png`

Quando o domínio público oficial da ZiisTec estiver publicado, substituir essa URL nos quatro templates pela URL do próprio domínio. Não usar Base64 no HTML.

## SMTP / remetente

Nenhuma credencial SMTP foi inventada ou adicionada. O remetente profissional ainda depende de configuração hosted.

Opções adequadas: Resend, Postmark, Brevo ou outro SMTP transacional. O remetente final deve ser algo como `ZiisTec <acesso@dominio>` ou `ZiisTec <noreply@dominio>`, não uma conta Gmail pessoal.

DNS normalmente necessário conforme o provedor:
- SPF (TXT);
- DKIM (TXT/CNAME conforme provedor);
- DMARC (`_dmarc`, TXT);
- Return-Path/bounce CNAME quando solicitado pelo provedor.

Desabilitar link tracking do provedor se ele reescrever URLs de autenticação, pois isso pode interferir nos links do Supabase Auth.

## Homologação manual de caixa de entrada

Após aplicar os templates hosted e URL Configuration em Staging:
- Owner: criar conta nova, abrir o e-mail, confirmar e entrar.
- Técnico: owner convidar e-mail novo, conferir empresa/branding, confirmar, entrar e comprovar membership.
- F11: antes da confirmação, membership deve permanecer ausente e convite não aceito.
- Recuperação: solicitar reset, abrir link, definir nova senha.
- Gmail/mobile: conferir logo, largura, botão e legibilidade em tela estreita.

Não considerar a experiência de e-mail hosted homologada antes desses testes de caixa de entrada.
