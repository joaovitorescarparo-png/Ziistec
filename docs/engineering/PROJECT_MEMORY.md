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
- `src/legacy/ZiisTecApp.jsx` ainda passa por reconstrução + codemods Round 3.x. Não fazer refatoração grande desse pipeline junto com feature/bugfix.
- Recursos V2 devem ser absorvidos pelo shell principal sem criar dois produtos paralelos.

## Ambientes

- Trabalho de homologação ocorre em `hardening-v2-staging`.
- Integração ocorre em `ui-v1-v2-merge`.
- `main` representa produção e não deve receber mudanças sem homologação/release explícito.
- Preview autorizado deve usar somente Staging; Production somente o projeto de produção. Configuração errada deve falhar fechada.

## Segurança e autorização

- RLS/RPC é autoridade; frontend oculto não substitui autorização.
- Tenant isolation é por empresa.
- `owner` administra dados administrativos e financeiros.
- `technician` acessa somente o necessário para executar trabalho atribuído e venda de campo autorizada.
- Custos privados vivem atrás de policies/RPCs que técnico não lê.
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
- Mudança visual/UX relevante precisa de teste humano no Preview mesmo com CI verde.

## Dívidas conhecidas que não devem ser misturadas em feature pequena

- Refatorar o pipeline legado/codemods para fonte canônica limpa.
- Paginação/lazy loading para carregamentos grandes.
- Revisões futuras de índices/performance somente com volume/métrica real.
- Automação SaaS de cobrança/assinatura é trabalho de produto separado de hardening.

## Direção de produto aprovada

- Histórico técnico deve evoluir para Cliente → Local → Ativos → Histórico de serviços.
- Financeiro V2 deve evoluir em camadas: pagar/receber → fluxo de caixa/visão gerencial → cobrança → conciliação bancária → fiscal → pagamentos por parceiro regulado.
- Não construir todas essas camadas ao mesmo tempo.

## Como atualizar esta memória

Adicione apenas fatos que uma sessão futura ficaria surpresa — e agradecida — de saber antes de começar. Não adicionar logs, hashes temporários, URLs de deploy efêmeras, passos de debugging ou detalhes facilmente recuperáveis do código.
