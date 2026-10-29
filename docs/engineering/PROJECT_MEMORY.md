# ZiisTec — memória curta do projeto

> Carregue este arquivo quando uma nova sessão de IA precisar entender decisões que não devem ser redescobertas do zero. Mantenha curto; detalhes pertencem ao código, migrations, testes e runbooks.

## Produto

- ZiisTec é um SaaS/ERP multiempresa para prestadores técnicos.
- Fluxo principal: cliente → orçamento → aprovação → OS → agenda → execução → financeiro → garantia/histórico.
- A experiência do técnico é deliberadamente menor que a do proprietário: foco em trabalho de campo, não em administrar o ERP.
- O proprietário pode liberar produtos específicos para venda em campo; o técnico vê preço final, nunca custo/margem.

## Arquitetura

- Frontend React/Vite.
- Supabase é a autoridade de autenticação, dados, RLS, Storage e RPCs.
- Vercel hospeda Preview/produção.
- `src/legacy/ZiisTecApp.jsx` e as fontes V2 consolidadas são canônicas; build/verify normais são read-only. Reconstrução + codemods históricos só rodam explicitamente via `npm run materialize:legacy`.
- Recursos V2 devem ser absorvidos pelo shell principal sem criar dois produtos paralelos.
- Assistente: o provedor de IA só propõe nomes/quantidades/valores ditos; o banco (`zt_assistant_plan`) resolve cliente, catálogo, IDs e preço, e toda escrita passa por prévia + confirmação (`previewHash`). Provedores de IA só são chamados pelo gateway neutro `api/_aiGateway.js` (Gemini principal; Anthropic opcional), atrás de `ENABLE_EXTERNAL_AI` + `AI_PROVIDER` + chave + quota; frases simples usam fast-path local sem IA. IA nunca é autoridade de banco (IDs, preço, permissões, exclusões). Contexto ativo ("esse orçamento") é só dica do navegador: `zt_assistant_reference` revalida empresa, papel, assinatura e estado e devolve contexto sem IDs nem custo. Consultas do proprietário passam só por `zt_assistant_read` (owner, somente leitura, sem custo/margem); o resultado vai para a tela e nunca para o provedor. Número isolado ("150") só vale como dinheiro em resposta à última pergunta monetária do próprio servidor.

## Ambientes

- A base de homologação humana é `rc1c-mobile-ux-stabilization`; mudanças experimentais usam branches próprias antes de aprovação humana.
- Integração ocorre em `ui-v1-v2-merge`.
- `main` representa produção e não deve receber mudanças sem homologação/release explícito.
- Preview autorizado deve usar somente Staging; Production somente o projeto de produção. Configuração errada deve falhar fechada.

## Segurança e autorização

- RLS/RPC é autoridade; frontend oculto não substitui autorização.
- Tenant isolation é por empresa.
- `owner` administra dados administrativos e financeiros.
- `technician` acessa somente o necessário para executar trabalho atribuído e venda de campo autorizada.
- Custos privados vivem atrás de policies/RPCs que técnico não lê.
- Valores comerciais da OS também (0105): o técnico não lê `work_order_items` direto (recebe `zt_field_work_order_items`, sem preço), nem a linha `service_report` (recebe `zt_get_service_report`, sem pagamento/preço), nem `work_orders.approved_*`. `work_orders` tem SELECT por coluna para `authenticated`: coluna nova precisa de grant explícito e a Data API não aceita `select *`.
- Convites, membership e desativação precisam ser validados no backend.
- Não mass-revogar SECURITY DEFINER só pelo nome; revisar função por função e seus guards.

## Regras de negócio importantes

- Orçamento aprovado carrega snapshot comercial para a OS; desconto/acréscimo não pode desaparecer no faturamento.
- Adição posterior precificada pelo owner pode somar à cobrança; item técnico sem preço precisa de precificação antes de faturar.
- Custo/material interno não é automaticamente receita do cliente.
- Finalização e operações com efeito financeiro precisam ser seguras a retry/idempotência.
- Soft delete preserva documentos históricos; arquivado não deve voltar a ser fonte de novo documento quando isso viola a regra de negócio.
- Documento privado histórico continua legível pelo owner conforme política de assinatura, mas escrita pode permanecer bloqueada.
- Venda de campo deve usar preço resolvido no banco, respeitar `sale_enabled`, atualizar estoque com proteção de concorrência e gerar origem financeira rastreável.

## Qualidade

- `npm run verify:v2` é o gate principal de aplicação.
- `bash scripts/run-sql-rls-ci.sh` reproduz migrations e regressões em Supabase descartável.
- CodeQL cobre PRs de integração.
- Migrations de segurança/regra de negócio devem ganhar teste SQL/RLS rollback-safe quando aplicável.
- Numeração: a frente do Assistente ocupa 0093–0097 (0095 = Wave 2, já no Staging; 0096 = consultas do proprietário e 0097 = escritas canônicas, ambas da branch `claude/assistant-universal-owner-v1`). 0098 = renovação de assinatura pelo admin da plataforma (beta). 0099 = convites do beta fechado + plano Profissional R$ 79,90. Blocos 3/4 portados na branch `claude/blocks34-port-beta-v1` a partir de 0100 (0100 = Comprovante de Serviço; 0101–0104 = atores da OS, relato idempotente, local na OS direta e histórico só do proprietário), sem aplicar no Staging. 0105 = Bloco 5, projeção sem valores para o técnico (mesma branch, não aplicada). As migrations dos Blocos 3/4 (branch `blocks-3-4-os-history-receipt`, hoje 0093–0098) precisam ser renumeradas para depois da última migration existente antes de integrar.
- Beta: primeiro proprietário em `beta.ziistec.com` (Staging, sem técnicos); domínio, Auth, SMTP e renovação em `docs/engineering/BETA_OWNER_ONBOARDING.md`.
- Mudança visual/UX relevante precisa de teste humano no Preview mesmo com CI verde.
- Formulário com alteração não fecha sem perguntar (Bloco 6): `Modal` recebe `dirty` (`useFormDirty`), telas usam `useDiscardGuard`, navegação que troca a tela chama `confirmDiscardNavigation()`. Salvar fecha pelo próprio fluxo, sem pergunta; envio repetido usa `requestId` estável enquanto o formulário estiver aberto.
- Esc/Voltar no modal, rascunho mínimo (só Novo cliente e Nova OS, sessionStorage por usuário+empresa) e limites do iOS: `docs/engineering/MOBILE_RESILIENCE.md` (Bloco 7).

## Dívidas conhecidas que não devem ser misturadas em feature pequena

- Refatorar o pipeline legado/codemods para fonte canônica limpa.
- Paginação/lazy loading para carregamentos grandes.
- Revisões futuras de índices/performance somente com volume/métrica real.
- Automação SaaS de cobrança/assinatura é trabalho de produto separado de hardening.
- Valor do plano em `subscriptions.amount` é legível por qualquer membro ativo (preço público do plano, não financeiro da empresa); restringir exige revisar leituras de plataforma/configurações.

## Feedback Beta Cliente 01 — implementado na próxima versão (ainda não no Beta Live)

- Logo no PDF: caixa única ~48 × 18 mm (136 × 51 pt, contain) nos quatro PDFs, em `src/lib/pdfLogoBox.js`; a logo normalizada continua PNG nos PDFs gerados no navegador.
- Rotas da OS: Google Maps, Waze e Apple Maps em `src/lib/routeApps.js`. A preferência é do **usuário**, não da empresa (`user_route_preferences`, migration 0106, RLS `user_id = auth.uid()`, sem company_id). Sem a 0106 a escolha vale só na sessão. Coordenadas só do cadastro do cliente e só quando o endereço do atendimento é o dele.
- Homologação isolada (H0) e ordem frontend → migrations 0100–0110: `docs/engineering/H0_HOMOLOGATION_PLAN.md`. Nenhuma dessas migrations está aplicada em ambiente real.
- Auditoria de segurança V1 (`docs/engineering/SECURITY_AUDIT_V1.md`): a 0107 fecha a escrita do técnico em `maintenance_contract_id`/`contract_cycle` da OS (suprimia a cobrança do ciclo) e entra no mesmo pacote da 0105. Todo campo novo de OS que seja administrativo ou financeiro precisa entrar na lista do guard `zt_guard_work_order_technician_update`. O `postbuild` varre `dist/` atrás de segredo de servidor (`scripts/verify-dist-secrets.mjs`); `VITE_*` é público.
- Segurança V1.1 (0108–0110, definers 142): FK entre tabelas de tenant é sempre composta por `company_id` (fornecedor de produto/compra; a 0108 aborta sem mexer em dados se o ambiente já tiver vínculo cruzado); ajuste manual de estoque exige `p_request` (o overload sem pedido só serve ao executor do Assistente); o e-mail de convite passa por `zt_claim_team_invite_email` antes de enviar (60 s, 5/h por destinatário, 30/h por empresa) e a função `team-invite-email` só entra depois da 0110. Campos livres no HTML do convite são neutralizados, não escapados para entidades: o Auth já usa `html/template`.
- Field Execution Intelligence V1 (0111, definers 149; detalhes em `docs/engineering/FIELD_EXECUTION_INTELLIGENCE.md`): Base Técnica interna por OS (causa, solução, dificuldade, observação) + confirmação de quem recebeu + livro de gerações de IA. `needs_return` e `started_at` são reutilizados (nenhum segundo booleano nem contador de duração no banco). O relatório do cliente só recebe fatos confirmados lidos pelo **banco** (nunca custo, margem, financeiro ou texto livre do navegador), no máximo 3 gerações por OS, e sempre tem o texto padrão determinístico como fallback: a IA nunca bloqueia a conclusão. Base Técnica e confirmação são gravadas **antes** da finalização atômica (que continua com uma única chamada). O frontend novo cai sozinho no fluxo antigo quando o banco não tem a 0111. Assinatura desenhada: PENDENTE; assinatura por link de WhatsApp: só design documentado.
- Fim de linha: `.gitattributes` fixa LF em `*.sh` e `*.sql`. Sem isso um clone limpo no Windows (`core.autocrlf=true`) falhava 1 teste de regex multilinha; confirme `verify:v2` também em worktree limpo.

## Consolidação V1 e preparação fiscal (2026-10-28)

- Auditoria ampla em `docs/engineering/SYSTEM_CONSOLIDATION_V1.md`: 14 duplicações achadas, 4 removidas, 8 funções mortas apagadas, 4 bugs (1 P2, 3 P3) corrigidos entre a V1 e a V1.1. O que sobrou (Compras, Configurações e Orçamentos com duas telas; `speech-patch.js` × `useSpeechInput`; escopo de auth repetido em `api/ai.js` e `api/finance-ai.js`) só muda depois da H0 e da decisão do dono.
- "Hoje" é sempre `hojeISO()` de `src/lib/dates.js` (dia do aparelho); nunca `toISOString().slice(0,10)`, que dá o dia UTC e erra das 21h às 24h no Brasil (teste varre `src/`). Moeda é sempre `brl` de `src/lib/money.js`.
- Datas (V1.1): nenhuma constante de módulo guarda "hoje" (um teste lê o código por AST e só aceita a semente de demonstração do shell); o shell relê o dia com `useDiaLocal` ao voltar a ser usado, sem timer. Somar meses é sempre `addMesesISO` (limita ao último dia do mês de destino, como o `interval` do Postgres); nunca `setMonth` em regra de negócio.
- Antes de apagar função "sem uso", procure também no texto dos testes e dos `verify-*`: vários gates leem o código-fonte como string e quebram sem aviso do compilador.
- Fiscal: só desenho em `docs/engineering/FISCAL_ARCHITECTURE_V1.md`. O Comprovante de Serviço (0100) é documento **não fiscal** e continua separado de qualquer NFS-e (`fiscal_documents` futuro, referenciando `billing_entry_id`, nunca criando receita). Nenhum provedor contratado, nenhuma credencial, nada emitido; a F1 (sandbox) exige autorização própria. Regulatório conferido em fonte oficial (gov.br, 2026-10-29): ME/EPP do Simples emitem pelo Emissor Nacional a partir de **01/11/2026** (Resolução CGSN 191/2026), então NFS-e Nacional é requisito eliminatório; IBS/CBS no Simples vale em 01/01/2027. Provedor **não escolhido**: Spedy (preço da API PENDENTE) e Focus NFe são candidatos, comparados só com o que as páginas oficiais provam.

- Hardening adversarial V1.2 (0112, definers 149; `docs/engineering/RELEASE_HARDENING_V12.md`): 1 P2 e 7 P3, 2 corrigidos. `company_members` não aceita mudar `id`, `company_id` nem `user_id` (o dono podia reescrever `user_id` e puxar qualquer usuário para a própria empresa); as rotas `api/*` nunca repassam o corpo de erro do banco (`api/_apiErrors.js`: só as frases exatas das RPCs de cota). Nova rota que mostre erro do banco ao navegador deve usar o mesmo padrão. 0112 não aplicada em ambiente real; H0 e Fiscal seguem não iniciados.

- First 10 Customers · Fase 1 (`docs/engineering/FIRST_CUSTOMERS_PHASE1.md`): o fluxo cliente → orçamento → OS → execução → conclusão → financeiro → comprovante → histórico tem um teste de jornada no banco (`v2_first_customers_golden_path_rollback.sql`, 32 checks) além dos testes por recurso. O PDF do Comprovante de Serviço abre com a frase exata "Comprovante de serviço — documento não fiscal." (`IDENTIFICACAO_NAO_FISCAL`, desenhada direto: `clean()` trocaria o travessão por hífen). Pendências que não são de código: 0100–0112 não aplicadas em nenhum ambiente, Production em 0049 e vazia, H0 em aparelho real e E2E autenticado sem credenciais.

- H0 (`docs/engineering/H0_ENVIRONMENT_REQUIRED.md`, 2026-10-29): o H0 **não existe**. Na org Supabase há 3 projetos: Production `diztevlpbcfqleizswxr`, Beta Live `xadoktssibuuebzzjrhv` (hoje **pausado**) e `uvjovxrpnvxsxrlvngpj`, sem nenhuma referência no repo, nas docs nem no git: identidade não provada, não usar. O H0 precisa de projeto novo, vazio, sa-east-1 (conector informou US$ 0/mês), criado pelo proprietário. As guardas só aceitam dois pares (Production e Staging) e a CSP da `vercel.json` só os dois refs: o H0 entra como terceiro par isolado, só nesta branch (bloqueador de merge para a `main`). Ensaio local 0099→0112 com dados: 54/54, definers 134→140→142→149, 0108 aborta com vínculo cruzado sem alterar nada, banco atualizado no lugar passa 42/42.

## Direção de produto aprovada

- Histórico técnico deve evoluir para Cliente → Local → Ativos → Histórico de serviços.
- Financeiro V2 deve evoluir em camadas: pagar/receber → fluxo de caixa/visão gerencial → cobrança → conciliação bancária → fiscal → pagamentos por parceiro regulado.
- Não construir todas essas camadas ao mesmo tempo.

## Como atualizar esta memória

Adicione apenas fatos que uma sessão futura ficaria surpresa — e agradecida — de saber antes de começar. Não adicionar logs, hashes temporários, URLs de deploy efêmeras, passos de debugging ou detalhes facilmente recuperáveis do código.
