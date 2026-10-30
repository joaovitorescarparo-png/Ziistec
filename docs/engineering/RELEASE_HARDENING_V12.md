# Hardening adversarial V1.2 — última revisão antes do H0

Data: 2026-10-29 · Branch `claude/blocks34-port-beta-v1` · HEAD inicial `640ce7959c8f69ff52306830ffe9c755561292e9`.
Objetivo: tentar **quebrar** os controles que já existem (V1, V1.1, Field Execution) e só criar teste onde o risco foi provado.
Sem funcionalidade nova, sem redesenho, sem refactor estético.

## 1. O que não foi tocado

Beta Live, Production, `main`, dados reais, Supabase real, Vercel Production, domínios, Auth real, e-mails reais, NFS-e/Fiscal e H0.
Nenhuma migration foi aplicada em ambiente real (a 0112 existe só no repositório e no banco descartável do CI). Todos os ataques rodaram
contra código local, testes com `fetch` bloqueado e um Postgres descartável reconstruído a partir de `supabase/0001…0112` com as identidades
sintéticas de `ci_local_seed.sql`. `AGENTS.md` e `docs/engineering/GRAPHIFY.md` continuam locais e fora do commit.

## 2. Resultado

| Fase | Tema | Resultado | Evidência |
|---|---|---|---|
| 1 | Cross-tenant / IDOR / BOLA | PASS | ataque diferencial: 4 identidades × 47 tabelas com `company_id` (leitura, UPDATE, DELETE) + 391 chamadas RPC; 0 vazamentos, 0 linhas alteradas na empresa vítima |
| 2 | Escalada de privilégio | PASS (1 achado P2 corrigido) | 33 tentativas × 3 identidades; SEC-V12-02 corrigido (0112) |
| 3 | Rotas `api/*` e função de e-mail | PASS (1 achado P3 corrigido) | método, tipo, tamanho, corpo, sessão, papel, cota e erro; SEC-V12-03 corrigido |
| 4 | Abuso de IA | PASS | o banco decide: cota por minuto/dia, 3 relatórios por OS, fatos sem custo; frases exatas provadas no SQL |
| 5 | XSS / URL / injeção | PASS | sem `dangerouslySetInnerHTML`/`innerHTML`/`eval`; URLs `javascript:`/`data:` normalizadas; `<a target=_blank>` com `rel=noopener/noreferrer`; o `window.open` do `wa.me` no legado (host fixo, número só com dígitos) segue sem `noopener`, que é o SEC-09 já aceito; CSP `script-src 'self'` |
| 6 | Uploads | PASS (3 P3 aceitos) | RPC valida caminho exato, MIME, tamanho, etapa e empresa; Storage por prefixo de empresa + OS atribuída |
| 7 | Sessão / desativação | PASS | desativado com JWT válido perde RPCs, leitura, cota e Storage; reativar devolve o acesso |
| 8 | Repetição / idempotência | PASS | `request_id` repetido não duplica; 6 scripts de concorrência no CI cobrem estoque, convite, e-mail, upload, comprovante e relatório de IA |
| 9 | Segredos | PASS | HEAD e últimos 200 commits sem segredo; só a URL local de CI; `VITE_*` só públicos; `verify-dist-secrets` no build |
| 10 | Cabeçalhos | PASS (1 P3 aceito: HSTS vem da plataforma) | CSP, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP, `frame-ancestors 'none'` |
| 11 | Taxa / abuso | PASS (2 P3 aceitos) | mapa em §6 |
| 12 | Vazamento de erro | PASS | as três rotas que repassavam o corpo do banco agora devolvem só frases fixas |
| 13 | Resiliência | lacunas documentadas (§8) | nada executado em Beta/Production |
| 14 | Testes | 55 checks SQL + 29 testes JS novos | ver §5 |

## 3. Achados

| ID | Sev. | Achado | Cenário concreto | Situação |
|---|---|---|---|---|
| SEC-V12-02 | **P2** | O proprietário reescrevia `company_members.user_id` | `update company_members set user_id='<UUID de outro usuário>' where id='<vínculo de técnico da própria empresa>'` colocava a vítima na empresa sem convite nem e-mail confirmado, liberava o perfil dela (nome/telefone) e permitia `zt_update_team_member` sobre ela. Se a vítima não tinha empresa salva, o app escolhe `memberships[0]` e a levaria para o contexto do atacante | **Corrigido** — 0112 |
| SEC-V12-03 | P3 | `api/ai.js`, `api/finance-ai.js` e `api/quote-pdf.js` repassavam `message` do corpo de erro do PostgREST | erro 404/500 do banco na cota devolvia ao navegador "Could not find the function public.zt_consume_ai_quota … schema cache" | **Corrigido** — `api/_apiErrors.js` |
| SEC-V12-01 | P3 | Oráculo de existência/estado em ~18 RPCs antigas | "OS inexistente" (P0002) e "OS de outra empresa" (42501) são distinguíveis; `zt_register_installed_equipment` trava a linha e checa `status` antes da permissão | Aceito |
| SEC-V12-04 | P3 | Storage confere o `Content-Type` declarado, não o conteúdo | um membro autenticado sobe HTML com `Content-Type: image/png` no prefixo da própria empresa | Aceito |
| SEC-V12-05 | P3 | Sem cota de armazenamento por empresa | um membro grava objetos soltos (sem registro em `attachments`) até o limite do projeto | Aceito |
| SEC-V12-06 | P3 | Cota de IA/PDF é por usuário+empresa, não por empresa | N proprietários/colaboradores = N×100 chamadas de IA por dia | Aceito |
| SEC-V12-07 | P3 | `vercel.json` não declara HSTS | a Vercel já envia `Strict-Transport-Security: max-age=63072000` ([docs](https://vercel.com/docs/encryption)); declarar de novo poderia reduzir o valor | Aceito |
| SEC-V12-08 | P3 | A função de e-mail responde `existing_user` | o proprietário descobre se um e-mail já tem conta (ele já conhece o e-mail e só ele chama) | Aceito |

Contagem: P0 = 0, P1 = 0, **P2 = 1**, **P3 = 7**. Corrigidos: **2** (SEC-V12-02, SEC-V12-03). Aceitos e documentados: 6.

## 4. Correções (um problema = teste + correção pequena)

**SEC-V12-02 — `supabase/0112_company_member_identity_guard.sql`.** Trigger `BEFORE UPDATE` recusa (42501) qualquer mudança de `id`, `company_id`
ou `user_id` de `company_members`, para todos os papéis, inclusive o dono do banco. Nenhum fluxo do aplicativo as altera (só `status` e
`job_title`); troca de usuário ou de empresa é convite novo. A função é de trigger, `security invoker`, sem EXECUTE para ninguém: o número de
`SECURITY DEFINER` continua 149. Reprodução antes da correção: no banco sem a 0112 o `update … set user_id` **passou** e o teste SQL falhou
em 21 checks (10 da seção 1 e os que dependem do vínculo sequestrado); com a 0112 os 55 checks passam. Rollback manual (só para ensaio, reabre o achado):
`drop trigger trg_guard_company_member_identity on public.company_members; drop function public.zt_guard_company_member_identity();`.

**SEC-V12-03 — `api/_apiErrors.js`.** `quotaUserMessage(detail, fallback)` só devolve a mensagem do banco quando ela é **exatamente** uma das 8 frases
de produto que as RPCs de cota levantam (`Limite diário de IA atingido`, `Assinatura inativa` etc.); qualquer outro corpo (código PGRST, `details`,
`hint`, JSON inesperado, HTML de proxy, frase parecida com texto extra) vira o texto fixo da rota. Reprodução antes da correção: 21 dos 29
testes JS novos falham no código original e passam com a correção. Um teste liga a lista às migrations (cada frase existe como `raise exception`).

## 5. Testes novos

- `supabase/tests/v2_release_hardening_v12_rollback.sql` (55 checks, registrado em `scripts/run-sql-rls-ci.sh`): imutabilidade do vínculo; registro de
  evidência com caminho adulterado, empresa trocada, OS da vítima, MIME HTML/SVG/executável, tamanho acima do limite/negativo/nulo, SHA, nome e etapa
  inválidos; técnico não atribuído; colaborador desativado com JWT válido contra as sete RPCs da 0111, leitura, cota e Storage (com controle positivo
  antes e depois); cota de IA (10/min, 100/dia) e de PDF (30/min, 300/dia) com a frase exata; assinatura vencida; anônimo; empresa vítima intacta.
- `tests/blockers/release_hardening_v12.test.mjs` (29 testes, em `verify:v2`): as três rotas com erro 400/401/403/404/500/503 do banco, corpo não JSON e
  frase fora da lista; frases de produto preservadas; lista fixa ligada às migrations; 0112 registrada.
- Três contratos de lista de migrations (`security_v11_contracts`, `block7_mobile_resilience`, `wave2_routes`) passaram a esperar a 0112.

## 6. Mapa de abuso e limites

| Superfície | Limite existente | Onde vive |
|---|---|---|
| IA de orçamento / financeira | 10 por minuto, 100 por dia por usuário+empresa; corpo ≤ 32 KB; IA paga desligada por padrão (`ENABLE_EXTERNAL_AI`) | `zt_consume_ai_quota`, `api/ai.js`, `api/_aiGateway.js` |
| Assistente | cota própria + planejador fail-closed; só o banco executa | `zt_assistant_consume_ai_quota`, `api/assistant.js` |
| Relatório de IA da OS | 3 gerações por OS (contagem no banco, retry idempotente, expiração) | 0111 |
| PDF de orçamento | 30 por minuto, 300 por dia; corpo ≤ 8 KB; só proprietário | `zt_consume_quote_pdf_quota` |
| Convite por e-mail | cooldown e limites por hora por empresa, convite e destinatário, decididos no banco | 0110 |
| Convite beta | validação no banco e script de concorrência (`test-beta-invite-concurrency.sh`) | 0098/0099 |
| Upload | 15 MB foto, 30 MB vídeo, 20 MB documento; MIME permitido no bucket e na RPC | buckets + `zt_register_work_order_evidence` |
| Armazenamento por empresa | **sem cota** (SEC-V12-05) | — |

## 7. Riscos que só o H0 ou a produção validam

Cabeçalhos reais servidos pela Vercel (inclusive HSTS e o valor efetivo da CSP no Preview), tempo e limite de função serverless sob carga, comportamento do
Storage real com `Content-Type` falso, latência e falha do provedor de IA com chave real, expiração e renovação de JWT em aparelhos reais, convite por
e-mail com remetente real, o plano de volta por restauração de backup e o comportamento de um frontend novo contra o banco 0099 (modo reduzido) em
aparelhos Android e iPhone.

## 8. Resiliência (lacunas, nada executado)

- **Backup/restauração:** o plano de volta do H0 é restaurar backup, mas nenhuma restauração foi ensaiada; o H0 deve ensaiar antes do passo 4. Para o
  Beta Live valem regras mais duras já registradas em `H0_HOMOLOGATION_PLAN.md` §5.
- **Migration que falha no meio:** cada arquivo é aplicado em ordem; não há reversa automática de 0100–0104. A 0112 é reversível (trigger + função).
- **Frontend incompatível com o banco:** o frontend novo tem leitura tolerante e cai para o fluxo antigo sem a 0111 (testes `field_execution_*`). A
  ordem segura continua: frontend primeiro, depois migrations.
- **Supabase fora do ar:** o app mostra erro de carregamento e mantém rascunhos de formulário na aba (`formDrafts.js`); não há fila offline (decisão em
  `MOBILE_RESILIENCE.md`).
- **Provedor de IA fora do ar ou desligado:** fail-closed — a rota devolve 503/502 genérico, a cota só é consumida depois dos portões e o fluxo de
  fechamento da OS continua sem IA.
- **Vercel fora do ar:** sem plano de contingência de hospedagem; risco aceito nesta fase.

## 9. Como reproduzir

```bash
npm run verify:v2                        # inclui tests/blockers/release_hardening_v12.test.mjs
bash scripts/run-sql-rls-ci.sh           # no Supabase descartável do CI; inclui v2_release_hardening_v12_rollback.sql
```

Contagem de cenários executados: 955 no ataque diferencial (188 leituras, 376 escritas, 391 RPCs) + 99 de escalada + 36 de oráculo de existência + 55 checks SQL
novos + 29 testes JS novos = **1.174**, além das revisões estáticas (rotas `api/*`, função de e-mail, sinks de XSS, segredos em HEAD e histórico, cabeçalhos).
