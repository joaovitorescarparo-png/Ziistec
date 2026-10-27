# H0 — plano de homologação isolada da próxima versão

> **Este documento é só um plano.** O H0 não foi criado nem executado. Nada aqui autoriza tocar o Beta Live
> (`xadoktssibuuebzzjrhv`, `beta.ziistec.com`), a Production, a `main`, Auth, domínio ou dados do cliente real.
> Criar o projeto H0 pode gerar custo e precisa de decisão explícita do proprietário do produto.

## 1. Objetivo

Provar, num ambiente **descartável e separado**, que a próxima versão (branch `claude/blocks34-port-beta-v1`) funciona de ponta
a ponta com banco e frontend juntos, antes de qualquer decisão sobre o Beta Live:

1. as migrations **0100–0110** aplicam limpas, na ordem, sobre um banco no estado do Beta Live (**0099**);
2. o frontend novo continua utilizável contra o banco 0099 (modo reduzido) e fica completo depois das migrations;
3. proprietário e técnico executam o fluxo real em aparelhos reais (Android e iPhone), com o técnico sem acesso a preços;
4. o plano de volta (restaurar backup) foi ensaiado;
5. o ensaio de migração de dados do cliente real fica para um passo posterior e separado (não faz parte do H0).

Critério de saída: roteiro da seção 9 inteiro marcado, sem falha P0/P1 aberta, evidências anexadas (prints, aparelho, versão, data).

## 2. O que será homologado

| Item | Migration / origem | Resumo |
| --- | --- | --- |
| Comprovante de Serviço | 0100 | documento não fiscal, só proprietário, número CS-####, emissão idempotente, reemissão com motivo |
| Autores do ciclo da OS | 0101 | quem iniciou e quem concluiu (`started_by`, `completed_by`) |
| Relato idempotente | 0102 | `request_id` no relato; salvar de novo não duplica |
| Local direto na OS | 0103 | `client_location_id` gravado pela OS |
| Histórico por cliente/local | 0104 | `zt_client_service_history` (só proprietário) e `zt_work_order_history_detail` |
| Técnico sem preços | 0105 | itens e relato sem valores para o técnico; `work_orders` com SELECT por coluna |
| Preferência de rota por usuário | 0106 | `user_route_preferences` (uma linha por usuário, RLS própria) |
| Técnico não reescreve contrato/ciclo da OS | 0107 | trava de UPDATE do técnico cobre `maintenance_contract_id` e `contract_cycle` (auditoria de segurança V1, SEC-01) |
| Fornecedor sempre da mesma empresa | 0108 | FK composta `(supplier_id, company_id)` em produtos e compras; **aborta sem alterar nada** se o ambiente já tiver vínculo cruzado (SEC-03) |
| Ajuste de estoque idempotente | 0109 | `zt_adjust_product_stock(..., p_request)`: o mesmo pedido altera o estoque uma vez; o overload antigo perde o EXECUTE do navegador (SEC-04) |
| Limite de reenvio do convite | 0110 | `zt_claim_team_invite_email`: 60 s por convite/destinatário, 5/h por destinatário, 30/h por empresa; guarda só hash do e-mail (SEC-05) |
| Frontend | Blocos 6 e 7, Onda 1, Onda 2 | formulários protegidos, rascunho, V2 no app principal, logo nos PDFs, Início, rotas |

Estado esperado do banco: **definers = 134** no 0099, **140** depois da 0105 e **140** depois da 0106 (a 0106 não cria função) e **140** depois da 0107 (ela só substitui uma função de trigger existente). A 0108 não cria função; a 0109 e a 0110 criam uma cada: **142** depois da 0110.

## 3. Ordem segura: frontend novo → migrations

Regra dura: a **0105 revoga `select *` em `work_orders`** e quebra o frontend atual do Beta Live (`f33791e`). Por isso, em qualquer
ambiente que tenha o frontend antigo, a ordem é sempre: **(1) frontend novo, (2) migrations juntas, em ordem**, nunca a 0105 sozinha.

Sequência do ensaio no H0:

1. Criar o banco do H0 no estado **0099**: baseline de produção + migrations 0050–0099, exatamente como o CI faz em
   `scripts/run-sql-rls-ci.sh` (sem os arquivos 0100+). Usar dados sintéticos (seção 7).
2. Publicar o **frontend antigo** (`f33791e`) apontando para o H0 e conferir o fluxo básico (referência de comportamento atual).
3. Publicar o **frontend novo** (esta branch) apontando para o H0, ainda com o banco em 0099. Conferir o **modo reduzido**:
   - telas abrem, OS e agenda funcionam, nada mostra erro técnico;
   - Comprovante, histórico por local e preferência persistente aparecem como "ainda não disponível na sua conta" (ou valem só na sessão);
   - "Abrir rota" funciona com o app padrão (Google Maps) e a troca de app vale só na sessão.
4. Aplicar **0100 → 0101 → 0102 → 0103 → 0104 → 0105 → 0106 → 0107 → 0108 → 0109 → 0110**, um arquivo por vez, cada um em uma transação
   (`psql -v ON_ERROR_STOP=1 -1 -f <arquivo>`), conferindo a seção 4 depois de cada passo.
5. Recarregar o frontend novo e executar o roteiro completo (seção 9).
6. Publicar a função `team-invite-email` desta branch **somente depois da 0110**: sem a reserva de envio ela recusa o envio (503, falha fechada).
   Antes da 0109, o frontend novo ajusta estoque pelo overload antigo (sem idempotência); depois dela, só pelo novo, com o mesmo `p_request` em cada nova tentativa.

## 4. Verificações depois das migrations (somente leitura)

Rodar no H0, nunca no Beta Live:

- as onze migrations aparecem em ordem e sem erro (a 0108 só falha se o ambiente já tiver fornecedor de outra empresa em produto/compra: nada é alterado, e a mensagem traz a consulta de somente leitura para tratar o caso);
- `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef;` → **142**;
- `has_table_privilege('authenticated','public.work_orders','SELECT')` é falso para a tabela inteira e verdadeiro por coluna (exceto `approved_*`);
- `user_route_preferences`: RLS ligada, `anon` sem privilégio, `authenticated` sem DELETE, três policies com `user_id = auth.uid()`;
- o pacote `supabase/tests/*_rollback.sql` roda no CI descartável (`bash scripts/run-sql-rls-ci.sh`); no H0 só consulta de catálogo, sem escrita.

## 5. Rollback

H0 é descartável: a volta oficial é **restaurar o backup** feito antes do passo 4 (ou recriar o banco a partir do 0099) e republicar o frontend
anterior. Não há reversa automática para 0100–0104 (criam tabelas, colunas, gatilhos e funções com dados do próprio uso).

Se for preciso desfazer só uma etapa no H0 (ensaio manual; conferir cada policy em `pg_policies` antes):

- **0110:** `drop function public.zt_claim_team_invite_email(uuid); drop table public.team_invite_email_sends;`. A função `team-invite-email` nova passa a recusar o envio (503) sem a reserva: reverter a função junto.
- **0109:** `drop function public.zt_adjust_product_stock(uuid,uuid,numeric,text,uuid);` e devolver o EXECUTE do overload antigo a `authenticated, service_role`. As colunas `client_request_id` e `balance_after` podem ficar. O frontend novo cai sozinho para o ajuste antigo.
- **0108:** voltar as FKs simples: `alter table public.products drop constraint products_supplier_company_fk, add constraint products_supplier_id_fkey foreign key (supplier_id) references public.suppliers(id) on delete set null;` (idem `purchases`). Só para ensaio: reabre o SEC-03.
- **0107:** recriar `public.zt_guard_work_order_technician_update()` com o corpo da 0031 (sem `maintenance_contract_id` e `contract_cycle`). Só para ensaio: reabre o SEC-01.
- **0106:** `drop table public.user_route_preferences;`. O frontend volta ao modo "vale na sessão" sem erro.
- **0105:** devolver o estado anterior:
  `grant select on table public.work_orders to authenticated;`
  `alter policy p_wo_items_select on public.work_order_items using (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id));`
  `alter policy p_wo_rep_select on public.work_order_reports using (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id));`
  Depois `revoke execute` e `drop function` de `zt_get_service_report` e `zt_field_work_order_items`. Isso devolve preços ao técnico: só para ensaio.
- **0100–0104:** correção para frente (nova migration) ou restauração do backup. Não apagar `service_receipts` com comprovantes emitidos fora do H0.

Para um futuro upgrade do Beta Live valem regras mais duras (decididas à parte): backup restaurável **testado**, janela combinada, frontend primeiro, pacote
inteiro, e plano de volta por restauração. Nada disso é feito agora.

## 6. Ambiente e riscos de configuração

- **Não usar o Beta Live nem a Production como H0.** O frontend tem guardas que falham fechadas por host; o projeto de staging pré-configurado em
  `src/lib/supabase.js` é o do Beta Live. Antes de qualquer Preview apontar para o H0 é preciso incluir o novo projeto e o host do Preview nas listas
  permitidas (`src/lib/supabaseConfig.js` e `api/_supabaseServerConfig.js`) e revisar esses guardas. Sem isso o Preview não conecta, e é o comportamento seguro.
- Custo: um projeto Supabase novo (e o plano dele) e um Preview na Vercel. Decidir antes de criar. Alternativa gratuita só para validação técnica de SQL: Supabase local
  (Docker), que **não** serve para teste humano em celular.
- Auth, SMTP e domínio do H0 são independentes dos do Beta. Sem e-mail real do cliente, sem convites reais.
- Segredos (chaves, senhas dos usuários de teste) ficam em gerenciador de senhas, nunca no repositório ou em chat.

## 7. Dados sintéticos necessários

Criar do zero no H0 (nada vindo do Beta Live):

- **Empresa A** "H0 Demo A" com logo PNG transparente e três logos de teste (horizontal, vertical, quadrada); **Empresa B** "H0 Demo B" para isolamento.
- **Usuários:** `owner` A, `technician` A (celular iPhone), `owner` B. Criar pelo painel de Auth com e-mail confirmado; senhas fora do repositório.
- **Clientes:** um com endereço, coordenadas e place id; um só com endereço; um **sem endereço** (testa a mensagem de rota); com mais de um local cadastrado.
- **Catálogo:** serviços; produtos com foto, um com estoque no mínimo ou abaixo (alerta do Início), um inativo, um liberado para venda em campo.
- **Orçamentos:** um aprovado com desconto (snapshot comercial), um em rascunho.
- **OS:** aguardando, agendada, em andamento, concluída com relato, checklist e fotos; uma concluída com Comprovante emitido e outra para emitir.
- **Financeiro:** receita a receber e recebida, despesa a pagar vencida, compra com item do catálogo.
- **Garantia** automática e manual; **contrato/preventiva** com ciclo; **pós-venda** com política.

## 8. Usuários e aparelhos

| Papel | Aparelho | Uso |
| --- | --- | --- |
| Proprietário A | Android + desktop | roteiro administrativo completo |
| Técnico A | iPhone | execução em campo; nunca vê preço |
| Proprietário B | desktop | isolamento entre empresas |

## 9. Roteiro de teste humano

Marcar cada item com aparelho, data e evidência. Falha = registrar P0/P1/P2 com cenário.

**Acesso e visão geral**
- [ ] Login do proprietário A, recuperação de senha e saída da conta.
- [ ] Início: atendimentos de hoje, pendências, **Serviços concluídos recentemente** (sem valores) e **alerta de estoque baixo** (só proprietário).
- [ ] Técnico: Início sem financeiro, sem alerta de estoque, sem atalhos administrativos.

**Cadastros e documentos**
- [ ] Cliente: criar, editar; **Locais no mapa** abre pelo cliente e volta à aba Clientes.
- [ ] Local cadastrado; orçamento com local; aprovação; **OS gerada com o valor aprovado**.
- [ ] Agenda: agendar, mover, semana/mês; técnico vê só as OS dele.

**Execução em campo (técnico, iPhone)**
- [ ] Iniciar a OS (registra quem iniciou); relato por voz/texto; fotos por etapa; checklist; concluir.
- [ ] Salvar o relato duas vezes seguidas (duplo toque / reenvio) → um único relato.
- [ ] **Técnico sem preços:** itens da OS, relato e rede do navegador sem `unit_price`, pagamento nem totais aprovados.
- [ ] Venda em campo de produto liberado com preço final (sem custo/margem).

**Financeiro e documentos (proprietário)**
- [ ] Conclusão gera a cobrança; baixar pagamento; recibo em PDF.
- [ ] **Financeiro** (aba) e **Visão gerencial** (V2): projeção de caixa, rentabilidade por OS, resumo com IA (se habilitado).
- [ ] **Comprovante de Serviço:** emitir, repetir a emissão (mesmo comprovante), **reemitir com motivo**, PDF de cada versão; técnico não vê.
- [ ] **Histórico** por cliente/local na OS; detalhe da OS anterior (valores só para proprietário).
- [ ] **Logo nos PDFs** (orçamento, recibo, relatório, comprovante) com logo horizontal, vertical e quadrada: proporção preservada, sem fundo preto, texto ao lado.

**Produtos, garantia e recorrência**
- [ ] **Estoque** (V2 pela aba Serviços e produtos): entrada, ajuste, histórico, mínimo; compra alimenta o estoque.
- [ ] **Garantia** manual e automática; visita de garantia sem cobrança.
- [ ] **Contratos/preventivas:** gerar ciclo (duas vezes → sem duplicar); **Pós-venda:** política, pendências, concluir/adiar.

**Rotas (Android e iPhone)**
- [ ] OS com endereço e coordenadas: **Abrir rota** abre o app padrão; **Abrir com outro app** lista os dois restantes (sem repetir o atual).
- [ ] **Google Maps**, **Waze** e **Apple Maps** abrem a rota certa em cada aparelho (Apple Maps no Android/desktop abre no navegador).
- [ ] **Preferência de rota:** proprietário escolhe Waze, técnico escolhe Apple Maps; cada um mantém a sua após sair e entrar; um não altera o outro; empresa B não é afetada.
- [ ] OS **sem endereço:** botão desligado e mensagem "Este atendimento ainda não possui um endereço disponível para abrir a rota." sem texto técnico.
- [ ] Endereço com acento, espaço, `&` e `#`: o destino chega inteiro ao app.
- [ ] Antes da 0106 (passo 3): trocar de app vale só na sessão, sem erro.

**Resiliência móvel**
- [ ] **Formulário com alteração não salva:** fechar, Esc, Voltar do Android e troca de aba perguntam antes de descartar; Cancelar e salvar não perguntam.
- [ ] **Recuperação de rascunho:** Novo cliente e Nova OS recuperam o rascunho depois de recarregar (iOS: anotar o limite se o PWA for encerrado).
- [ ] Perda de rede durante o salvar: sem duplicar, mensagem amigável.

**Isolamento e segurança**
- [ ] Proprietário B não vê nada da empresa A (clientes, OS, comprovantes, preferência).
- [ ] Colaborador desativado perde o acesso na hora.
- [ ] Nenhuma tela mostra termos como migration, RPC, RLS ou "preview".

## 10. Resultado do H0

Preencher ao final: versão do frontend (SHA), banco (última migration), aparelhos, data, lista de falhas por prioridade, decisão (liberar para planejamento do upgrade do Beta Live / corrigir e repetir).
