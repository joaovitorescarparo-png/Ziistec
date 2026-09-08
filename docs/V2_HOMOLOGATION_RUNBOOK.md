# ZiisTec Stack V2 — Runbook de Homologação

> **Regra de ouro:** executar em ambiente de homologação/desenvolvimento com usuários de teste reais. Não usar dados de cliente reais. Não aplicar a stack 0050→0061 na produção antes deste runbook ficar verde.

## Pré-requisitos

- Branch/deployment da aplicação: `product-v2-review`.
- Banco de homologação com migrations 0050→0061 aplicadas na ordem.
- 1 usuário `owner` ativo da empresa A.
- 1 usuário `technician` ativo da empresa A.
- Opcional e recomendado: 1 owner da empresa B para teste cross-tenant.
- Assinatura da empresa A em `trial` ou `active` durante os testes operacionais.
- Navegador mobile/tablet com câmera, microfone e geolocalização autorizados.

## Critério global de aprovação

A homologação só fica **VERDE** quando:

1. nenhum teste abaixo expõe custo, margem, fornecedor ou financeiro ao técnico;
2. nenhuma tentativa cross-tenant retorna dados ou grava alterações;
3. retries/duplo clique não duplicam orçamento, OS, compra, estoque ou cobrança;
4. todos os arquivos/mídias ficam no tenant correto;
5. PDF do cliente não contém custo/margem;
6. build, `Verify`, CodeQL e preview Vercel continuam verdes no mesmo HEAD;
7. Supabase Security Advisor é revisado depois das migrations;
8. não há erro `error`, `fatal` ou 5xx novo nos logs do preview durante o fluxo.

---

## 1. Login e isolamento por empresa

### Owner A
- Entrar com conta owner real.
- Abrir Stack V2.
- Confirmar acesso aos módulos administrativos.

**Esperado:** acesso normal somente à empresa A.

### Técnico A
- Entrar com conta technician real.
- Abrir Stack V2.

**Esperado:** módulos owner-only não aparecem/não abrem; acesso de campo continua disponível.

### Cross-tenant
- Com token/sessão da empresa A, tentar acessar IDs válidos da empresa B via UI/API.

**Esperado:** 0 linhas ou 403/42501. Nunca retornar conteúdo da empresa B.

---

## 2. Clientes e locais

### Owner
- Criar/editar cliente.
- Usar endereço textual.
- Usar localização atual.
- Salvar latitude/longitude/Maps URL/Place ID quando disponível.
- Abrir rota no Google Maps.

**Esperado:** dados persistem na empresa A e a rota aponta para o local correto.

### Técnico
- Tentar alterar cadastro/local do cliente diretamente.

**Esperado:** bloqueado por RLS; nenhuma alteração persistida.

---

## 3. Catálogo, estoque e compras

### Owner
- Criar produto com custo, preço e estoque controlado.
- Registrar compra de 5 unidades.
- Repetir a mesma requisição/retry.
- Editar a compra de 5 para 8.
- Editar de 8 para 6.

**Esperado:** estoque 5 → continua 5 no retry → 8 → 6. Nunca duplicar movimento.

### Técnico
- Abrir catálogo de campo.

**Esperado:** vê somente campos comerciais permitidos; não recebe custo/margem/fornecedor.

- Vender 1 produto em uma OS atribuída e aberta.

**Esperado:** estoque reduz exatamente 1 vez; técnico não vê custo privado.

- Tentar vender em OS não atribuída/fechada.

**Esperado:** bloqueado.

---

## 4. Orçamento com voz/IA

### Owner
- Criar orçamento por voz/texto com cliente conhecido, 1 serviço e 1 produto.
- Informar explicitamente um preço diferente do catálogo.
- Criar item livre/gratuito.
- Forçar uma ambiguidade de cliente/produto.

**Esperado:**
- preço falado explicitamente vence o preço do catálogo;
- IA não inventa IDs;
- ambiguidade exige confirmação humana;
- custo/margem são acrescentados localmente para owner e não enviados como catálogo confidencial para a IA;
- salvar gera um único rascunho.

### Correção por IA
- Corrigir a prévia com uma instrução curta.

**Esperado:** mantém os demais dados e altera apenas o solicitado, sujeito à normalização/validação.

---

## 5. Gestão de orçamentos e PDF

- Mover rascunho → enviado → aprovado.
- Duplicar orçamento.
- Gerar PDF.
- Compartilhar/baixar PDF.

**Esperado:**
- duplicado nasce como novo rascunho;
- PDF contém venda/total e informações do cliente;
- PDF **não contém** `unit_cost`, custo interno ou margem;
- imagem PNG/JPEG de produto pode aparecer; WEBP incompatível não derruba o PDF;
- endpoint exige owner autenticado e quota.

---

## 6. Orçamento aprovado → OS

- Aprovar orçamento.
- Gerar OS sem data.
- Repetir a geração/duplo clique.

**Esperado:** exatamente 1 OS ligada ao orçamento.

- Em outro orçamento aprovado, gerar com data e hora.

**Esperado:** OS nasce agendada.

- Tentar informar hora sem data.

**Esperado:** bloqueado.

- Técnico tentar gerar OS a partir do orçamento.

**Esperado:** bloqueado.

---

## 7. Memória técnica da OS

### Técnico atribuído
- Abrir OS.
- Registrar relato por voz.
- Adicionar evidência `Antes`, `Durante`, `Depois`, `Equipamento`.
- Adicionar vídeo permitido.
- Registrar material/serial quando aplicável.
- Finalizar atendimento.

**Esperado:** mídia e relato ficam vinculados à OS/empresa corretas; histórico concluído continua pesquisável.

### Segurança
- Técnico tentar anexar mídia em OS de outro técnico ou OS fechada quando a policy exigir OS aberta.

**Esperado:** bloqueado.

- Técnico inspecionar payload/tela da OS.

**Esperado:** custos privados continuam ausentes/zerados.

---

## 8. Finalização, custos privados e financeiro

### Owner
- Criar OS com item/material que tenha custo interno e `extra_cost`.
- Finalizar uma única vez.
- Repetir finalização/retry.

**Esperado:**
- custo de item/material/extra fica nos ledgers privados;
- coluna pública de custo não vaza valor;
- exatamente uma cobrança/efeito financeiro por finalização;
- retry não duplica.

### Técnico
- Tentar gravar `unit_cost` ou `extra_cost` não-zero diretamente.

**Esperado:** 42501/bloqueio; valor público continua zero.

---

## 9. Garantias e pós-venda

- Concluir serviço/produto com prazo de garantia.

**Esperado:** garantia criada uma única vez quando aplicável.

- Abrir atendimento dentro da cobertura.

**Esperado:** ligado à garantia/origem; fluxo de garantia não cria nova cobertura infinita nem cobrança indevida.

- Usar uma garantia expirada → `Criar orçamento pago com IA`.

**Esperado:** orçamento abre com contexto pré-preenchido e indicação explícita de atendimento pago; não transforma garantia vencida em gratuidade.

---

## 10. Preventivas e contratos

- Criar contrato recorrente.
- Gerar ciclo.
- Repetir geração do mesmo ciclo.

**Esperado:** ciclo/OS/financeiro não duplicam por retry.

---

## 11. Financeiro V2 + IA

### Owner
- Validar faturado, recebido, receber, despesas, atrasados e projeções 7/30/60.
- Conferir rentabilidade de OS contra custos privados conhecidos.
- Gerar análise IA manualmente.

**Esperado:**
- números batem com dados do banco;
- análise IA recebe somente snapshot agregado/sanitizado;
- endpoint verifica owner no servidor e consome quota;
- resposta não inventa cliente, causa ou número ausente.

### Técnico
- Tentar abrir Financeiro ou chamar endpoint diretamente.

**Esperado:** bloqueado/403 e nenhuma informação financeira retornada.

---

## 12. Configurações e assinatura

### Owner
- Alterar nome/telefone/padrões comerciais.
- Trocar logo.
- Cancelar assinatura de teste.
- Reativar quando permitido pelo servidor.

**Esperado:** alterações persistem; cancelamento não apaga dados.

### Técnico
- Tentar atualizar `companies`.
- Tentar cancelar/reativar assinatura via RPC.

**Esperado:** update 0/403/42501; assinatura inalterada.

**Observação:** forma de pagamento/checkout não deve existir como ação até haver provedor real integrado.

---

## 13. Assinatura bloqueada/desativação de colaborador

- Colocar assinatura de homologação em estado que bloqueia operação.

**Esperado:** dados permanecem; escrita operacional respeita o guard do servidor.

- Reativar.

**Esperado:** dados anteriores reaparecem intactos.

- Desativar técnico.

**Esperado:** perde acesso imediatamente nas novas requisições/sessão recarregada.

---

## 14. Mobile/tablet

Executar pelo menos em viewport de telefone e tablet:

- navegação V2;
- orçamento por voz;
- GPS;
- câmera/foto;
- vídeo;
- upload de logo/documento;
- PDF/compartilhamento;
- modal de geração de OS;
- finalização da OS;
- rolagem/teclado em formulários longos.

**Esperado:** sem overflow horizontal crítico, botão inacessível, modal preso ou perda de dados ao abrir teclado.

---

## 15. Fechamento técnico antes do merge

No **mesmo HEAD** candidato:

- `npm run verify:v2` → OK
- `npm audit --audit-level=high` → sem high/critical bloqueante
- `npm run build` → OK
- GitHub Verify → SUCCESS
- CodeQL → SUCCESS
- Vercel → READY
- preview shell/rotas V2 → HTTP 200 quando autenticadas/protegidas corretamente
- runtime logs → sem erro/fatal novo durante a homologação
- Supabase Security Advisor revisado após migrations
- Leaked Password Protection habilitado no Auth antes da abertura geral, se disponível no plano/configuração

## Regra de merge

Somente após todos os blocos críticos acima estarem verdes:

1. aplicar migrations de forma controlada no ambiente alvo;
2. repetir smoke tests pós-migration;
3. manter backup/rollback operacional;
4. tirar PR #9 de draft;
5. revisar diff final;
6. merge na `main`;
7. validar deploy de produção e logs imediatamente após publicação.
