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
- Homologação isolada (H0) e ordem frontend → migrations 0100–0106: `docs/engineering/H0_HOMOLOGATION_PLAN.md`. Nenhuma dessas migrations está aplicada em ambiente real.

## Direção de produto aprovada

- Histórico técnico deve evoluir para Cliente → Local → Ativos → Histórico de serviços.
- Financeiro V2 deve evoluir em camadas: pagar/receber → fluxo de caixa/visão gerencial → cobrança → conciliação bancária → fiscal → pagamentos por parceiro regulado.
- Não construir todas essas camadas ao mesmo tempo.

## Como atualizar esta memória

Adicione apenas fatos que uma sessão futura ficaria surpresa — e agradecida — de saber antes de começar. Não adicionar logs, hashes temporários, URLs de deploy efêmeras, passos de debugging ou detalhes facilmente recuperáveis do código.
