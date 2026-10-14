# Beta — primeiro proprietário em `beta.ziistec.com`

Escopo: o primeiro proprietário real, **sem técnicos**, usando o Staging `xadoktssibuuebzzjrhv` pelo domínio `beta.ziistec.com`. Production, `main`, checkout e Blocos 3/4 ficam fora.

Cada passo abaixo marcado **(João)** é manual e não é feito por agente: DNS, Vercel, Dashboard do Supabase e segredos.

## 0. Pré-condições

- Decisão registrada de usar o Staging com dado real durante o beta.
- Backups/PITR do Staging conferidos no Dashboard.
- Smokes no Staging só com rollback forçado. Nenhum teste usa o tenant do beta.
- Migration `0098_platform_subscription_renewal.sql` aplicada no Staging, com autorização explícita. Sem ela, a renovação do §4 não existe.

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
| Google | `signInWithOAuth` | o provedor está **desligado** no Staging; o botão aparece e falha; não usar no beta |
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

**Preparação única (João, SQL Editor do Staging):**

```sql
update public.profiles set is_platform_admin = true where email = '<email do João>';
```

**Uso (João, SQL Editor do Staging).** O SQL Editor roda como `postgres`. As duas primeiras linhas atribuem a ação ao perfil admin para a auditoria. Só use dentro do Dashboard.

```sql
begin;
select set_config('request.jwt.claim.sub', '<UUID_DO_PERFIL_ADMIN>', true);
select set_config('request.jwt.claims', json_build_object('sub','<UUID_DO_PERFIL_ADMIN>','role','authenticated','aal','aal2')::text, true);
select public.zt_platform_renew_subscription('<UUID_DA_EMPRESA>'::uuid, date '2026-11-30', 'trial', 'Beta: extensão do teste');
commit;
```

Para encontrar a empresa e conferir o resultado:

```sql
select c.id, c.name, s.status, s.current_period_start, s.current_period_end
  from public.companies c join public.subscriptions s on s.company_id = c.id
 where c.name ilike '%<nome>%';
select action, before_data, after_data, created_at
  from public.platform_audit_logs where company_id = '<UUID_DA_EMPRESA>' order by created_at desc limit 5;
```

Regressão: `supabase/tests/v2_platform_subscription_renewal_rollback.sql`, no CI SQL/RLS. A tela de plataforma ainda não tem botão de renovação, só de status.

## 5. Onboarding do primeiro proprietário

| # | Passo do cliente | Conferência |
|---|---|---|
| 1 | Acessa `https://beta.ziistec.com` | abre a tela de login sem pedir conta da Vercel |
| 2 | Cria a conta com e-mail e senha | aparece o aviso de confirmação por e-mail |
| 3 | Confirma o e-mail | o e-mail chega pelo SMTP próprio; o link volta para `https://beta.ziistec.com/` já autenticado |
| 4 | Cria a empresa | `zt_create_company` cria o proprietário e o trial de 14 dias |
| 5 | Recebe o trial | em Configurações, trial até D+14; o admin confere pela consulta do §4 |
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
