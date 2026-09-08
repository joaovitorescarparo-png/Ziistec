## Objetivo

Descreva o comportamento que esta mudança altera e o resultado observável esperado.

## Escopo

- [ ] Mudança pequena e focada; sem refatoração adjacente não solicitada.
- [ ] Arquivos/áreas fora do escopo permaneceram intocados.
- [ ] Se envolve `src/legacy/ZiisTecApp.jsx`, a mudança sobrevive ao pipeline de reassemble/codemods.

## Segurança e dados

- [ ] RLS/RPC/backend continua sendo a autoridade; não depende só de UI oculta.
- [ ] Tenant isolation foi preservado.
- [ ] `technician` não recebe custo, margem, financeiro administrativo ou documento privado.
- [ ] Nenhum segredo/token/chave privada foi commitado.
- [ ] Operação com dinheiro/estoque/retry foi revisada para idempotência/concorrência quando aplicável.

## Banco / migration

- [ ] Não há mudança de banco; ou
- [ ] Migration nova foi versionada e aplicada primeiro em Staging.
- [ ] Teste SQL/RLS rollback-safe foi adicionado/atualizado quando aplicável.
- [ ] Owner, technician e cross-tenant foram considerados quando aplicável.

## Verificação

- [ ] `node scripts/verify-project-governance.mjs`
- [ ] `npm run verify:v2`
- [ ] `npm run build`
- [ ] SQL/RLS CI passou quando aplicável.
- [ ] CodeQL/segurança passou quando aplicável.
- [ ] Preview de Staging está READY.
- [ ] Fluxo alterado foi testado manualmente quando envolve UX.

## Evidência

Cole aqui testes, queries, screenshots ou passos de homologação que provam o resultado.

## Release

- [ ] Esta PR não altera Production diretamente.
- [ ] Promoção para `main` só ocorrerá após homologação e aprovação explícita de release.
