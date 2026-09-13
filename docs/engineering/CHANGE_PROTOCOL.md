# ZiisTec — protocolo de mudança com IA

Este protocolo transforma pedidos em alterações pequenas, verificáveis e revisáveis. Ele adapta ao ZiisTec as práticas úteis do vibe-coding-toolkit sem instalar o toolkit inteiro.

## 1. Classifique o pedido antes de codar

Determine quais superfícies serão tocadas:

- UI/React;
- Supabase/schema/RLS/RPC;
- financeiro/estoque;
- autenticação/equipe/permissões;
- PDF/documentos;
- infraestrutura/CI/Vercel;
- somente documentação.

Se houver mais de uma interpretação razoável que muda comportamento ou dados, esclareça antes de implementar. Se o pedido já estiver claro, não crie uma rodada de perguntas desnecessária.

## 2. Escreva objetivos verificáveis

Troque “melhorar X” por comportamentos observáveis.

Exemplo:

- ruim: “corrigir venda do técnico”;
- bom: “técnico vende somente produto `sale_enabled`, não recebe custo, estoque baixa uma vez e retry não duplica financeiro”.

Cada objetivo deve ter uma prova: teste, query, build, comportamento no Preview ou combinação deles.

## 3. Planeje o menor diff

Antes de editar:

1. encontre a autoridade real da regra;
2. reutilize schema/RPC/componente existente quando ele já resolve o domínio;
3. liste arquivos que precisam mudar;
4. identifique arquivos que não devem ser tocados;
5. se houver migration, defina teste SQL/RLS antes de aplicar em Staging.

Não introduza abstração, dependência ou configuração só porque “pode ser útil no futuro”.

## 4. Delegação e ondas paralelas

Quando ferramentas de subagentes estiverem disponíveis, a sessão principal atua como orquestrador.

Rotas recomendadas:

| Lente | Use quando |
|---|---|
| Banco/RLS | migration, policy, RPC, trigger, concorrência, tenant isolation |
| Segurança | auth, convite, permissões, upload, segredo, endpoint, dados privados |
| Frontend | React, navegação, formulário, responsividade, acessibilidade |
| Testes | regressão, matriz de papéis, edge cases, idempotência |
| Financeiro | cobrança, desconto, estoque, lucro, baixa, reconciliação |

Duas tarefas podem rodar na mesma onda somente se:

- não editarem o mesmo arquivo;
- uma não depender do resultado da outra;
- não fizerem migrations concorrentes que disputem numeração/ordem;
- a integração final ocorrer depois da revisão de todos os resultados.

Se dois trabalhos precisam mexer em `src/legacy/ZiisTecApp.jsx` ou no mesmo codemod, faça sequencialmente.

## 5. Ordem de implementação

Para mudança de comportamento:

1. reproduzir/definir teste;
2. backend/authority first quando existir regra de segurança/dinheiro;
3. frontend apenas depois do contrato estar claro;
4. testes de regressão;
5. build/CI;
6. homologação manual quando UX real estiver envolvida.

Evite corrigir segurança apenas escondendo UI. O backend deve negar chamadas diretas indevidas.

## 6. Revisão multi-lente

Antes de considerar pronta uma mudança não trivial, revise independentemente pelas lentes aplicáveis:

- qualidade geral;
- segurança;
- banco/RLS/concorrência;
- React/UX;
- testes;
- financeiro/regra de negócio.

Formato de achado:

`arquivo:linha — severidade — problema — cenário concreto que faz falhar`

Depois:

1. deduplicar achados equivalentes;
2. confirmar no código, não confiar cegamente no revisor;
3. remover opinião sem cenário de falha;
4. ordenar CRITICAL → HIGH → MEDIUM → LOW;
5. não aumentar escopo por achados LOW sem aprovação.

## 7. Gates por tipo de mudança

### Sempre

- `node scripts/verify-project-governance.mjs`
- `npm run verify:v2`
- `npm run build`

### Banco/RLS/RPC

- migration versionada;
- aplicar em Staging, nunca Production durante homologação;
- regressão em `supabase/tests/`;
- `bash scripts/run-sql-rls-ci.sh` no ambiente descartável/local apropriado;
- testar owner, technician e cross-tenant quando aplicável.

### Auth/permissão/segredo

- revisão de segurança;
- CodeQL/CI verde;
- chamada direta indevida deve falhar no backend.

### Financeiro/estoque

- testar valor esperado;
- testar duplicidade/retry;
- testar concorrência quando houver decremento/contador;
- testar origem do lançamento;
- garantir que custo privado não vaza para technician.

### UI/mobile

- teste em Preview;
- portrait/landscape quando relevante;
- teclado/modal/scroll;
- loading/error/success;
- ação não autorizada não deve aparecer, mas backend continua sendo autoridade.

## 8. Commits e integração

- Prefira commits pequenos por objetivo verificável.
- Não misture migration de segurança, redesign e refatoração estrutural no mesmo commit.
- PR deve explicar risco, testes e qualquer migration.
- Não promover para `main` só porque Vercel está READY; release exige homologação e gates.

## 9. Memória após o trabalho

Atualize `PROJECT_MEMORY.md` somente se surgiu uma decisão estável que evitará erro futuro. Não registrar cronologia de debugging, URL temporária, hash efêmero ou detalhe facilmente derivável.
