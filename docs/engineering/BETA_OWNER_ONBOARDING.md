# Beta — primeiro proprietário em `beta.ziistec.com`

Escopo: o primeiro proprietário real, **sem técnicos**, usando o Staging `xadoktssibuuebzzjrhv` pelo domínio `beta.ziistec.com`. Production, `main`, checkout e Blocos 3/4 ficam fora.

Cada passo abaixo marcado **(João)** é manual e não é feito por agente: DNS, Vercel, Dashboard do Supabase e segredos.

## 0. Pré-condições

- Decisão registrada de usar o Staging com dado real durante o beta.
- Backups/PITR do Staging conferidos no Dashboard.
- Smokes no Staging só com rollback forçado. Nenhum teste usa o tenant do beta.
- Migration `0098_platform_subscription_renewal.sql` aplicada no Staging, com autorização explícita. Sem ela, a renovação do §4 não existe.
- Migration `0099_beta_invites_professional_plan.sql` aplicada no Staging. Sem ela, o onboarding não confere convite e o plano nasce com o default antigo.

## 1. Domínio (João)

1. **Vercel**, projeto `ziistec` → Settings → Domains → Add: `beta.ziistec.com`.
   - Ambiente: **Preview**.
   - Git branch: **`claude/assistant-universal-owner-v1`**.
   - Nunca ligar o domínio a Production.
2. **DNS** de `ziistec.com`: crie o registro que a Vercel mostrar, em geral `CNAME beta → cname.vercel-dns.com`. Aguarde "Valid Configuration" e o certificado HTTPS.
3. **Liberar só esse domínio:** Settings → Deployment Protection → **Deployment Protection Exceptions** → adicionar `beta.ziistec.com`. Está disponível em todos os planos.
   - A Standard Protection do projeto protege todos os domínios, menos os de produção. Um domínio de Preview ligado a uma branch continua pedindo login da Vercel até entrar nessa exceção.
   - Não troque a proteção do projeto: os aliases `*.vercel.app` e as outras previews continuam protegidos.
   - O acesso aos dados continua exigindo login do Supabase e a RLS.
   - Para reverter, remova o domínio da exceção.
4. As variáveis do Gemini já valem para o domínio, porque estão na mesma branch: `ENABLE_EXTERNAL_AI`, `AI_PROVIDER`, `GEMINI_MODEL` e `GEMINI_API_KEY`.

**Código:** o cliente só usa Staging em hosts listados em `STAGING_SUPABASE_HOSTS` (`src/lib/supabaseConfig.js`), e `beta.ziistec.com` está lá. Qualquer outro host falha fechado: `www`, `app`, apex, sufixos, `.com.br`. O mesmo vale para o domínio ligado por engano a um deploy de produção. O servidor (`api/_supabaseServerConfig.js`) resolve pela branch (`VERCEL_GIT_COMMIT_REF`), que já está em `STAGING_BRANCHES`. Se o beta passar para outra branch, ela precisa entrar nessa lista no mesmo commit. Testes: `tests/blockers/f08_environment_project_matrix.test.mjs`.

## 2. Supabase Auth do Staging (João)

O caminho no Dashboard é Authentication → URL Configuration.

| Campo | Valor |
|---|---|
| Site URL | `https://beta.ziistec.com` |
| Redirect URLs | adicionar **`https://beta.ziistec.com/`**, exato; manter as entradas atuais (hardening e RC-1D) |

O app só envia a raiz exata do domínio, montada por `resolverRedirectAuth` como `${origin}/` e só em HTTPS. Por isso basta a entrada exata. `https://beta.ziistec.com/**` também funcionaria, mas aceita qualquer caminho e contraria a regra do projeto de não usar curinga em allowlists.

Ao trocar o Site URL, os e-mails de outras previews continuam funcionando enquanto a raiz exata delas estiver em Redirect URLs.

**Callbacks reais do app:**

| Fluxo | Chamada | Retorno |
|---|---|---|
| Cadastro | `supabase.auth.signUp` com `options.emailRedirectTo` (`src/screens/Login.jsx`) | `https://beta.ziistec.com/` |
| Recuperação de senha | `supabase.auth.resetPasswordForEmail(email, { redirectTo })` | `https://beta.ziistec.com/`; o evento `PASSWORD_RECOVERY` abre `NovaSenha`, que chama `updateUser({ password })` |
| Login | `signInWithPassword` | sem redirect |
| Google | `signInWithOAuth` | o provedor está **desligado** no Staging; o botão fica oculto enquanto `VITE_ENABLE_GOOGLE_AUTH` não for `true` (padrão: oculto) |
| Convite de equipe | Edge Function `team-invite-email` (`redirect_to` = origem) | fora do beta (sem técnicos); o CORS da função não inclui o domínio beta |

Mantenha **Confirm email** ligado. Os templates são `supabase/templates/confirmation.html` e `recovery.html` e usam `{{ .ConfirmationURL }}`.

## 3. SMTP (João)

O SMTP padrão do Supabase só entrega para e-mails do time. Sem SMTP próprio, um cliente externo não confirma o cadastro nem recupera a senha.

1. Escolha um provedor transacional (Resend, Postmark ou Brevo) e verifique o domínio `ziistec.com` (SPF e DKIM).
2. Remetente: `ZiisTec <acesso@ziistec.com>` ou `noreply@ziistec.com`. Nada de Gmail pessoal.
3. Configure em Authentication → SMTP Settings: host, porta (587 ou 465), usuário, senha, nome e e-mail do remetente. **A senha fica só no Dashboard.** Nunca no repositório nem em chat.
4. Em Authentication → Rate Limits, ajuste o limite de e-mails por hora para o volume do beta.
5. Faça um teste de cadastro e outro de recuperação com um e-mail fora do time.

## 4. Renovação ou reativação da assinatura (admin)

O trial é de 14 dias, um por usuário (`zt_create_company`). Depois disso, escrita e Assistente ficam bloqueados. `zt_platform_set_subscription_status` só troca o status, então a renovação usa a RPC da 0098:

`public.zt_platform_renew_subscription(p_company uuid, p_period_end date, p_status 'trial'|'active', p_reason text)`

- Só administrador da plataforma com MFA (aal2). Proprietário, técnico, outro usuário e anon são recusados.
- Altera apenas status, período e `canceled_at`. Empresa, plano, valor, provedor e dados ficam intactos.
- O novo fim fica entre hoje e hoje + 400 dias. Use `trial` para o beta gratuito e `active` quando houver pagamento.
- Período vencido ou assinatura parada recomeça hoje (reativação). Período vigente só é estendido.
- O motivo é obrigatório. Cada mudança grava `platform_audit_logs` (`subscription_renewed`). Repetir a mesma renovação não muda nada.

**Não marque um perfil de uso como admin de forma permanente.** Com `profiles.is_platform_admin = true`, o app manda o usuário só para a tela de plataforma, que exige MFA (`src/App.jsx`, `ehPlataforma`). Ele perde o app de proprietário e o Assistente.

**Uso (João, SQL Editor do Staging).** O SQL Editor roda como `postgres`, o único papel que o trigger deixa alterar `is_platform_admin`.
- A flag fica ligada só dentro da transação e volta a `false` antes do `commit`.
- A auditoria grava o seu perfil como autor.
- Só use dentro do Dashboard.
- Se qualquer comando falhar, rode `rollback;`.

```sql
begin;
update public.profiles set is_platform_admin = true where id = '<UUID_DO_SEU_PERFIL>';
select set_config('request.jwt.claim.sub', '<UUID_DO_SEU_PERFIL>', true);
select set_config('request.jwt.claims', json_build_object('sub','<UUID_DO_SEU_PERFIL>','role','authenticated','aal','aal2')::text, true);
select public.zt_platform_renew_subscription('<UUID_DA_EMPRESA>'::uuid, date '2026-11-30', 'trial', 'Beta: extensão do teste');
update public.profiles set is_platform_admin = false where id = '<UUID_DO_SEU_PERFIL>';
commit;
```

Para usar a tela de plataforma no app, que tem MFA, crie uma conta dedicada só para admin. Não use a conta de proprietário.

Para encontrar a empresa e conferir o resultado:

```sql
select c.id, c.name, s.status, s.current_period_start, s.current_period_end
  from public.companies c join public.subscriptions s on s.company_id = c.id
 where c.name ilike '%<nome>%';
select action, before_data, after_data, created_at
  from public.platform_audit_logs where company_id = '<UUID_DA_EMPRESA>' order by created_at desc limit 5;
```

Regressão: `supabase/tests/v2_platform_subscription_renewal_rollback.sql`, no CI SQL/RLS. A tela de plataforma ainda não tem botão de renovação, só de status.

## 4.1 Convites do beta fechado (admin)

Só cria empresa nova quem tem convite beta válido para o mesmo e-mail confirmado no Auth (`zt_create_company`, 0099). Um cadastro sem convite cria só a conta e vê a tela "Beta fechado": nenhuma empresa, assinatura ou trial. Técnico convidado por uma empresa existente não precisa de convite beta (`zt_accept_invites` não muda).

- Um convite ativo por e-mail (sem diferenciar maiúsculas); validade de 1 a 90 dias (padrão 7); revogável enquanto não foi usado.
- Ao criar a empresa, o convite vira `used` com `used_by`, `used_at` e `company_id`, na mesma transação. Falha não consome o convite.
- `beta_invites` não tem acesso direto para anon nem para usuários. Listar, criar e revogar exigem administrador da plataforma com MFA. Criação e revogação gravam `platform_audit_logs`.
- Nenhum e-mail é enviado: passe `https://beta.ziistec.com` para a pessoa convidada.

**Pelo app (conta dedicada de admin com MFA):** Plataforma → aba **Beta** → e-mail e validade → **Adicionar convite**. A lista mostra status, expiração, uso, empresa criada e período do trial. **Revogar** só aparece para convite pendente.

**Fallback (João, SQL Editor do Staging):** mesma regra do §4: a flag de admin só existe dentro da transação. O admin não pode convidar o próprio e-mail.

```sql
begin;
update public.profiles set is_platform_admin = true where id = '<UUID_DO_SEU_PERFIL>';
select set_config('request.jwt.claim.sub', '<UUID_DO_SEU_PERFIL>', true);
select set_config('request.jwt.claims', json_build_object('sub','<UUID_DO_SEU_PERFIL>','role','authenticated','aal','aal2')::text, true);
select public.zt_platform_create_beta_invite('<email-do-convidado>', 7);
-- revogar: select public.zt_platform_revoke_beta_invite('<UUID_DO_CONVITE>');
update public.profiles set is_platform_admin = false where id = '<UUID_DO_SEU_PERFIL>';
commit;
```

Para conferir convite, empresa e trial:

```sql
select i.email, i.status, i.expires_at, i.used_at, c.id as company_id, c.name, s.plan, s.amount, s.status, s.current_period_start, s.current_period_end
  from public.beta_invites i
  left join public.companies c on c.id = i.company_id
  left join public.subscriptions s on s.company_id = i.company_id
 order by i.created_at desc;
```

Regressão: `supabase/tests/v2_beta_invites_rollback.sql` e `scripts/test-beta-invite-concurrency.sh`, no CI SQL/RLS.

**Assinatura no app:** trial mostra "Profissional · Teste grátis · X dias restantes · Depois do teste: R$ 79,90/mês" e a data de término. O proprietário não cancela nem reativa pelo app no beta: a tela orienta "Entre em contato com a ZiisTec para renovar o acesso" e a renovação segue o §4. Assinaturas antigas mantêm o plano e o valor gravados.

## 5. Onboarding do primeiro proprietário

| # | Passo do cliente | Conferência |
|---|---|---|
| 0 | (admin) Cria o convite beta para o e-mail do cliente (§4.1) | o convite aparece como Pendente |
| 1 | Acessa `https://beta.ziistec.com` | abre a tela de login sem pedir conta da Vercel, sem botão do Google e com "Acesso beta por convite" |
| 2 | Cria a conta com e-mail e senha | aparece o aviso de confirmação por e-mail |
| 3 | Confirma o e-mail | o e-mail chega pelo SMTP próprio; o link volta para `https://beta.ziistec.com/` já autenticado |
| 4 | Cria a empresa | `zt_create_company` confere o convite e cria o proprietário e o trial de 14 dias; sem convite aparece "Beta fechado" |
| 5 | Recebe o trial | em Configurações e em Minha conta: Profissional, teste grátis, dias restantes e R$ 79,90/mês depois do teste; o convite vira Utilizado (§4.1) |
| 6 | Entra | sair e entrar de novo funciona; recarregar mantém a sessão |
| 7 | Cria o primeiro cliente | o cliente aparece na lista |
| 8 | Cria o orçamento e aprova | o orçamento aparece com os totais certos |
| 9 | Cria a OS | a OS sai do orçamento aprovado, pela tela ou pelo Assistente ("Gere a OS do orçamento ORC-0001 para amanhã às 9h") |
| 10 | Usa o Assistente | "Qual meu próximo atendimento?", "Puxe o histórico do cliente <nome>" e ditado por voz respondem |

**Se algo falhar:**
- "Este endereço não está autorizado": o host não está na allowlist ou o domínio não está ligado à branch certa.
- O e-mail não chega: SMTP ou limite de envio.
- O link de confirmação abre outro endereço: Site URL ou Redirect URLs.
- "Assinatura inativa": renove pelo §4.

**Somente proprietário:** não convide técnicos no beta. O convite por e-mail não está liberado para o domínio, e a projeção de preços para o técnico ainda é pendência P1.

## 6. Reverter

- Tire `beta.ziistec.com` de Deployment Protection Exceptions, para voltar a exigir login da Vercel, ou remova o domínio. O app deixa de ficar público.
- Volte o Site URL para a preview `hardening`.
- Os dados permanecem no Staging.
