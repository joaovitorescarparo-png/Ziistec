# ZiisTec — regras para agentes de IA

Este arquivo é a fonte de verdade compartilhada para ChatGPT, Codex, Claude e qualquer outro agente que trabalhe neste repositório. Leia antes de alterar código.

## 1. Objetivo do produto

ZiisTec é um SaaS/ERP multiempresa para prestadores técnicos. O núcleo operacional é:

cliente → orçamento → aprovação → ordem de serviço → agenda → execução em campo → financeiro → garantia/histórico.

O sistema também possui catálogo, compras, equipe, permissões owner/technician e recursos V2 integrados gradualmente.

## 2. Stack

- React 18 + Vite 6 + JavaScript/JSX.
- Supabase: Auth, PostgreSQL, RLS, Storage e RPCs.
- Vercel para Preview/produção.
- npm e Node 24.x.
- GitHub Actions para verify, SQL/RLS e CodeQL.

## 3. Ambientes e branches

- Desenvolvimento/homologação ativo: `hardening-v2-staging`.
- Integração: `ui-v1-v2-merge`.
- Produção: `main`.
- Nunca alterar banco, deploy ou branch de produção durante uma tarefa de homologação.
- Nunca usar Production como fallback quando Preview/Staging estiver incompleto.
- Mudança de domínio, projeto Supabase ou ambiente exige revisar os guards fail-closed antes de liberar.

## 4. Regras de execução

1. Entenda o fluxo real antes de editar.
2. Declare a hipótese do bug ou objetivo observável.
3. Para bug, reproduza com teste quando viável antes da correção.
4. Faça a menor mudança que resolve o problema.
5. Não refatore código adjacente sem necessidade explícita.
6. Não faça redesign visual fora do escopo solicitado.
7. Não use uma mudança de segurança como oportunidade para reestruturar o produto inteiro.
8. Depois de alterar código, execute os gates canônicos e verifique o comportamento afetado.
9. Não marque uma tarefa como concluída porque “deveria funcionar”. Traga evidência executável.
10. Mudanças independentes podem ser paralelas somente se não editarem os mesmos arquivos e não dependerem uma da outra.

## 5. Segurança é autoridade do backend

- RLS/RPC/backend são a autoridade. Esconder botão no frontend nunca é controle de acesso suficiente.
- Toda linha multiempresa deve permanecer isolada por `company_id` ou mecanismo equivalente validado no banco.
- `technician` nunca deve receber custo, margem, fornecedor privado, financeiro administrativo ou documentos privados.
- Proprietário (`owner`) administra empresa, equipe, catálogo, financeiro, compras e configurações.
- Técnico trabalha somente nas OS permitidas/atribuídas e nos produtos explicitamente liberados para campo.
- Colaborador desativado deve perder acesso imediatamente pelo backend.
- Nunca confiar em preço, custo, empresa, papel ou ownership enviados pelo browser quando o banco pode resolver/validar o valor.
- Mutação financeira, estoque, aprovação, finalização, cobrança e garantia devem ser idempotentes quando retry puder ocorrer.
- Nunca commitar service role, senhas, tokens, chaves privadas ou segredos de ambiente.

## 6. Regras de dados e migrations

- Alteração de schema, RLS, trigger ou RPC persistente deve ser migration versionada.
- Antes de criar migration, descubra a última migration existente e use o próximo número; nunca reutilize número.
- Aplicar migration nova primeiro em Staging.
- Teste SQL/RLS deve ser rollback-safe ou rodar no Supabase descartável da CI.
- Soft delete preserva histórico. Registro arquivado pode continuar legível em documento antigo, mas não deve ser reutilizável para criar novo documento quando a regra de negócio proibir.
- Histórico não deve ser duplicado em tabelas sem necessidade: prefira referências estáveis e snapshots apenas onde o dado histórico precisa sobreviver a futuras edições.

## 7. Dinheiro e estoque

- Valores aprovados de orçamento devem sobreviver à conversão para OS por snapshot comercial.
- Material interno/custo não vira automaticamente cobrança do cliente.
- Técnico nunca define preço autoritativo de produto; o banco resolve o preço de venda vigente/autorizado.
- Venda e baixa de estoque devem ocorrer atomicamente ou ser protegidas contra concorrência/retry.
- Financeiro deve manter origem rastreável do lançamento (OS, compra, venda em campo etc.).

## 8. Pipeline legado — não quebrar

`src/legacy/ZiisTecApp.jsx` é reconstruído por `scripts/reassemble.mjs` e recebe codemods Round 3.x durante dev/build/verify.

- Não substituir esse pipeline em uma tarefa pequena.
- Não criar novos artefatos Base64/gzip para evoluir funcionalidade.
- Não editar somente o JSX reconstruído se a mudança precisa sobreviver ao próximo `reassemble`; atualize o codemod/fonte canônica correspondente.
- Refatoração para fonte canônica limpa é dívida técnica separada e deve ocorrer apenas com cobertura dos fluxos principais.

## 9. Comandos canônicos

Use estes comandos; não invente substitutos sem motivo:

- Instalação: `npm ci`
- Verificação principal: `npm run verify:v2`
- Auditoria de dependências: `npm run security:audit`
- Build: `npm run build`
- Desenvolvimento: `npm run dev`
- SQL/RLS completo: `bash scripts/run-sql-rls-ci.sh` dentro do ambiente Supabase local/CI apropriado.

GitHub Actions deve continuar validando build, guards, SQL/RLS e CodeQL antes de qualquer promoção de ambiente.

## 10. Revisão por risco

Para mudança não trivial, revisar por lentes independentes quando ferramentas/subagentes estiverem disponíveis:

- banco/RLS/concorrência;
- segurança/autorização/segredos;
- frontend/React/UX/acessibilidade;
- testes/regressões;
- regra de negócio/financeiro quando aplicável.

Cada achado precisa de cenário concreto de falha. Deduplicar e priorizar CRITICAL/HIGH antes de aumentar a lista com estilo/opinião.

## 11. Critério de pronto

Uma mudança só está pronta quando, conforme o risco:

- teste de reprodução/regressão passou;
- `npm run verify:v2` passou;
- `npm run build` passou;
- SQL/RLS passou para mudança de banco/permissão;
- CodeQL/CI relevante passou;
- Preview de Staging está READY;
- fluxo alterado foi homologado manualmente quando envolve UX real;
- Production permaneceu intocada até aprovação explícita de release.

## 12. Memória e protocolo

- Memória curta e estável: `docs/engineering/PROJECT_MEMORY.md`.
- Processo de mudança e revisão: `docs/engineering/CHANGE_PROTOCOL.md`.
- Runbook de homologação existente: `docs/V2_HOMOLOGATION_RUNBOOK.md`.

Mantenha estes documentos curtos e úteis. Não copie logs, cronologia de debugging nem fatos facilmente deriváveis do código para a memória permanente.
