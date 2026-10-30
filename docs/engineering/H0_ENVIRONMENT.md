# H0 ENVIRONMENT REQUIRED

Data: 2026-10-29 · Branch `claude/blocks34-port-beta-v1` · SHA `409519c` (CI verde) · Complementa `H0_HOMOLOGATION_PLAN.md`.
Resultado da investigação somente leitura: **não existe ambiente H0**. Nada foi criado, aplicado ou alterado em nenhum projeto.

## 1. Identidade dos ambientes (por configuração, não por nome)

| Projeto Supabase (org `tpdweuaunwqeuptphrhr`) | Região | Estado hoje | Prova de papel |
| --- | --- | --- | --- |
| `diztevlpbcfqleizswxr` "Ziistec 1" | ca-central-1 | ACTIVE_HEALTHY | **Production**: `PROD_SUPABASE_URL` em `src/lib/supabase.js` e `api/_supabaseServerConfig.js`, hosts da `main` em `PROD_SUPABASE_HOSTS`; 0 branches |
| `xadoktssibuuebzzjrhv` "ZiisTec V2 Staging" | sa-east-1 | **INACTIVE (pausado)** | **Beta Live**: `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_HOSTS` (inclui `beta.ziistec.com`), citado no plano H0 e em `BETA_OWNER_ONBOARDING.md` |
| `uvjovxrpnvxsxrlvngpj` "ziistec" | us-west-2 | INACTIVE (pausado), criado em 2026-06-29 | **Identidade não provada**: o ref não aparece no código, nas docs, no histórico do git (`git log --all -S`) nem na memória do projeto. Excluído: pode ter dados antigos e só se descobre restaurando, o que muda estado. |

Vercel (time `js-connect`): o projeto `ziistec` serve `ziistec.vercel.app` (produção) e `beta.ziistec.com` (ligado à branch `claude/assistant-universal-owner-v1`). O Preview desta branch é `ziistec-git-claude-blocks34-port-beta-v1-js-connect.vercel.app` (READY em `409519c`). Esse host **não está** em nenhuma lista permitida e a branch **não está** em `STAGING_BRANCHES`: o cliente resolve `unconfigured` e o servidor também. Ou seja, o Preview atual não alcança Beta nem Production (falha fechada, como deve ser), e por isso ainda não consegue falar com um H0.

Achado a decidir: o Supabase do Beta Live está **pausado**. Nada foi restaurado nesta sessão. Enquanto estiver assim, `beta.ziistec.com` não autentica. No plano Free o limite conhecido é de 2 projetos ativos (confirmar no painel): Production + H0 já ocupam os dois, então reativar o Beta exigiria pausar o H0 ou mudar de plano.

## 2. Recurso necessário

- **1 projeto Supabase novo, vazio, só para o H0**, na org acima. Nome sugerido: `ziistec-h0`.
- **Região `sa-east-1`**, a mesma do Beta Live (o estado 0099 foi construído e testado nela).
- **Custo conhecido:** o conector informou US$ 0/mês para projeto novo nesta org (plano Free). Branch Supabase **não** serve: custava US$ 0,01344/h em 26/08/2026 (`V2_STAGING_PROVISIONING.md`) e a política atual proíbe.
- Sem domínio novo: o Preview da branch (alias acima) basta. Sem IA externa: vale o texto padrão do produto. Sem SMTP próprio no H0.

## 3. O que o proprietário precisa fazer (mínimo)

1. **Criar o projeto** `ziistec-h0` pelo painel do Supabase (a senha do banco fica no gerenciador de senhas, não passa por mim). Se preferir que eu crie pelo conector, diga "autorizo criar o projeto H0 gratuito em sa-east-1"; o conector exige confirmar o custo antes.
2. **Me passar só o que é público:** o `ref`, a URL `https://<ref>.supabase.co` e a *publishable key* (`sb_publishable_…`). Nunca a `service_role`/secret key nem a senha do banco.
3. **Auth do H0** (painel): Site URL e Redirect URL = o alias do Preview acima. Criar 3 usuários com "Auto Confirm User": `owner A`, `technician A`, `owner B`. Use endereços seus com `+` (ex.: `seunome+h0a@…`) para a recuperação de senha chegar; as senhas ficam no gerenciador. Me passe apenas os 3 e-mails.
4. **Autorizar** a mudança de guardas descrita na seção 4 (só nesta branch).

Com isso eu provo a identidade do projeto (seção 5) antes de qualquer escrita e sigo para 0099 → 0112.

## 4. Mudanças de guarda preparadas (não aplicadas: dependem do ref)

Hoje há exatamente dois pares permitidos (Production e Staging). O H0 entra como **um terceiro par isolado**, sem tocar nos outros dois:

- `src/lib/supabaseConfig.js`: `H0_SUPABASE_HOSTS` com **só** o alias do Preview desta branch e um ramo `h0` no resolvedor que aceita **somente** o par exato do H0. Listas de Production e Staging não mudam; um teste exige que as três listas sejam disjuntas.
- `src/lib/supabase.js` e `src/lib/authRedirect.js`: o par/URL do H0 e o redirect para o host do H0.
- `api/_supabaseServerConfig.js`: a branch `claude/blocks34-port-beta-v1` resolve **só** para o H0; ela continua fora de `STAGING_BRANCHES`.
- `vercel.json` (CSP): hoje só aceita os dois refs conhecidos em `connect-src` e `img-src`. Sem acrescentar o host do H0 o Preview não conecta. **Isso entra só nesta branch e é bloqueador de merge** para a `main`, porque ampliaria a CSP da produção.
- Gates a ajustar junto: `f08_environment_project_matrix.test.mjs`, `verify-server-env-isolation.mjs`, `verify-v2-homologation.mjs`, `security_audit_v1_api.test.mjs`.
- Função `team-invite-email`: é por projeto (variáveis injetadas pela plataforma); só entra no H0 depois da 0110. `api/work-order-report` só depois da 0111.

## 5. Prova de identidade exigida antes de escrever no H0

Tudo somente leitura, e cada chamada seguinte carrega o ref do H0 e nenhum outro:

1. O ref informado é diferente dos três refs da seção 1.
2. `get_project`: mesma org, `ACTIVE_HEALTHY`, `created_at` posterior a 2026-10-29, região `sa-east-1`, nome com `h0`.
3. Banco vazio: sem tabelas em `public`, `auth.users` sem usuários além dos 3 de teste.
4. Se algo divergir: parar, sem migration e sem "tentar para descobrir".

## 6. O que já foi provado sem o H0 (laboratório local, não substitui o H0)

Ensaio descartável (PGlite, 0099 reconstruído do manifesto da produção como no CI, com dados criados pelas RPCs reais): 54/54 verificações.

- As 13 migrations aplicam limpas, uma por vez, cada uma em transação. Definers: 134 → 135 → 135 → 136 → 136 → 138 → **140** (0105, 0106, 0107, 0108) → 141 (0109) → 142 (0110) → **149** (0111, 0112), batendo com o plano.
- Linhas e colunas antigas de OS, financeiro e produtos continuam idênticas (mesmo hash) depois da 0112.
- Sobre a OS concluída e paga no 0099: o comprovante emite (CS-, não fiscal, R$ 680, idempotente), o histórico do cliente lista as duas OS com valor e pagamento, o estoque idempotente altera uma vez.
- Técnico: não lê `approved_*`, `select *` em `work_orders`, financeiro nem itens com preço; lê os itens pela projeção sem preço; não emite comprovante nem lê histórico. Dono B: nada da empresa A. Dono A não reescreve o `user_id` do vínculo (0112).
- A regra do plano se confirma: depois da 0105 o `select *` do frontend antigo falha para o técnico, por isso **frontend novo primeiro**.
- A 0108 **aborta** com fornecedor de outra empresa em produto, diz como tratar, e não deixa constraint nem dado alterado; corrigido o vínculo, 0108 → 0112 aplicam.
- Banco 0099 atualizado no lugar até 0112 passa a suíte SQL inteira: 42/42, igual ao banco montado do zero.

Limites: PGlite não é Supabase (sem Auth real, Storage real, PostgREST, Edge Functions nem rede). Isso não vale como H0.
