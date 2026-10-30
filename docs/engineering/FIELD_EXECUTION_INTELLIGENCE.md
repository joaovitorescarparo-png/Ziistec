# ZiisTec — Field Execution Intelligence V1

Evolução do fechamento de OS em campo: **OS → execução → Base Técnica estruturada → evidências → relatório do cliente (com IA opcional) → confirmação de quem recebeu → finalização → conhecimento técnico reutilizável**.
A análise de uma plataforma de gestão de serviços de campo foi usada só como referência funcional: nenhum código, layout ou marca foi copiado.

Estado: migration **0111** e frontend nesta branch (`claude/blocks34-port-beta-v1`). **Nada foi aplicado em banco real.** Beta Live (0099) e Production seguem intocados.

## 1. Auditoria: o que já existia e foi reutilizado

| Necessidade | Já existia | Decisão |
| --- | --- | --- |
| Início/fim do atendimento | `started_at`, `started_by` (0101), `completed_at` | Reutilizado. Duração calculada na tela; nenhuma coluna de duração, nenhum contador no banco |
| Necessita retorno | `work_orders.needs_return` + `work_order_returns` (0084) | Reutilizado. "Necessita retorno?" liga o mesmo resultado "retorno" do fechamento. **Nenhum segundo booleano** |
| Relato/relatório | `work_order_reports` (relato idempotente, 0102) | Reutilizado. O relatório do cliente continua sendo o relato da OS |
| Voz | `CampoVoz` + `useSpeechInput` | Reutilizado (uma só implementação). Ganhou o rótulo "Ditar" e `mergeDictation` |
| Materiais/produtos/estoque | itens da OS, `work_order_materials`, catálogo | Reutilizado. Material do relatório vem da OS, nunca de texto livre |
| Evidências | `attachments` (fotos por categoria) | Reutilizado. O fechamento mostra "N evidências anexadas"; nenhuma imagem vai para IA |
| Finalização | `zt_finalize_work_order_with_warranty_overrides` (atômica, idempotente) | **Intocada.** Uma única chamada de conclusão; só passou a informar sucesso/falha para a tela |
| Rascunho/dirty guard | Blocos 6 e 7 | Reutilizado. Só foi adicionado o formulário `base-tecnica` (texto) à allowlist |
| IA | `api/_aiGateway.js`, quota `zt_consume_ai_quota` | Reutilizados. Operação própria `api/work-order-report.js`, sem outra chave nem outro provedor |
| Rotas Maps/Waze/Apple | Onda 2 | Reutilizadas (`Endereco` nos cartões) |
| **Prioridade da OS** | **não existe** | **Não criada** (ver seção 7) |
| **Assinatura presencial** | **não existe** | **PENDENTE** (ver seção 7) |
| Confirmação de quem recebeu | só o texto de comprovante, sem nome | Criada (0111), separada da Base Técnica por conter nome de pessoa |

## 2. Modelo de dados (0111)

- `work_order_technical_base`: uma linha por OS (`cause`, `solution`, `difficulty` easy|medium|hard, `learning`, `revision`, `last_request_id`). Interna: nunca entra em documento do cliente. Leitura por RLS (proprietário ou técnico atribuído); escrita **só** por RPC.
- `work_order_attendance_confirmations`: `received_by_name` **ou** `receiver_absent` (nunca os dois); uma por OS.
- `work_order_ai_reports`: livro das gerações por OS. Sem policy e sem privilégio para o navegador; só as funções `SECURITY DEFINER` leem e gravam.
- Sete funções definer novas (total de definers: **149**): `zt_save_work_order_technical_base`, `zt_save_attendance_confirmation`, `zt_work_order_report_facts`, `zt_claim_work_order_ai_report`, `zt_complete_work_order_ai_report`, `zt_mark_work_order_ai_report_used`, `zt_work_order_ai_report_usage`.
- Regras comuns: permissão antes do lock da linha; OS inexistente e OS de outra empresa respondem igual (42501); escrita exige proprietário ou técnico **atribuído com OS aberta**; mesmo `p_request` com conteúdo diferente é recusado (23505); mesmo pedido com mesmo conteúdo devolve a mesma linha (retry não duplica).

## 3. Relatório com IA (anti-alucinação)

1. **Fatos pelo banco** (`zt_work_order_report_facts`): número da OS, serviço solicitado, serviços, causa e solução da Base Técnica, materiais confirmados (itens de produto + materiais registrados + produtos escolhidos na tela, validados no catálogo da mesma empresa), retorno. Chaves fixas: custo, preço, margem, dificuldade, observação técnica final, dados do cliente e financeiro **não existem** nesse conjunto.
2. **Prompt fixo**: a IA só organiza e corrige português dos fatos; não inventa causa, equipamento, peça, teste, quantidade nem resultado; causa vazia é omitida.
3. **Conferência da saída** (`reviewAiReport`): números, causa, resultado, retorno e termos novos fora dos fatos reprovam o texto; qualquer dúvida devolve o **texto determinístico**.
4. **Limite de 3 gerações por OS**, contado no banco (gerações concluídas valem sempre; pedido pendente vale por 90 s). Atualizar a página não devolve vaga. Reenvio do mesmo pedido devolve o texto já gerado. Quota da empresa só é gasta depois do limite.
5. **Fallback**: IA desligada, sem configuração, quota, limite, falha do provedor ou saída reprovada → texto padrão ("Foi realizado atendimento referente a …"). O técnico também pode escolher "Montar texto padrão" (sem rede). **Nunca bloqueia a conclusão.**
6. **Procedência**: "Gerado com auxílio de IA" (e "editado"); o banco guarda qual geração virou o relato, quem pediu, quando foi usada e se foi editada (`zt_mark_work_order_ai_report_used`). OS concluída não aceita nova geração, então o relato final não é sobrescrito em silêncio.
7. Limite conhecido: a conferência é heurística. A rede de segurança é o texto **editável e revisado pelo técnico** antes de salvar.

## 4. Painel do técnico e tempo

- **Meu dia** (Início do técnico): cliente, local, horário, endereço resumido (abre rota), telefone (`tel:`), resumo do serviço, estado e CTA "Iniciar atendimento" / "Continuar atendimento". Sem valores financeiros. Ordem: em andamento → horário marcado → demais atribuídas. Sem otimização paga de rota.
- **Tempo**: "Em atendimento · 1h 24min" calculado no navegador a cada minuto a partir de `started_at`. Aviso discreto a partir de 12 h ("Este atendimento está em andamento há bastante tempo. Confira se ele ainda está aberto."). **Nada fecha por tempo e nenhum carimbo é alterado.**
- Banco sem a 0101: `started_at` não existe; a leitura é tolerante e a tela mostra apenas "Em atendimento".

## 5. Fechamento em etapas (mobile)

Com a 0111: **Diagnóstico** (causa, solução, dificuldade, necessita retorno, observação técnica final, todos com "Ditar") → materiais → **Evidências** (contagem) → adicional → pendência → **Relatório** (editar, ditar, gerar com IA, texto padrão, descartar) → **Confirmação** (quem recebeu ou responsável ausente, resumo, conclusão).

- Base Técnica e confirmação são gravadas **antes** da conclusão (o técnico não consegue gravar depois que a OS fecha), com identificador por conteúdo: o mesmo conteúdo repete o mesmo pedido (retry seguro), conteúdo novo gera pedido novo.
- Falha de rede: mensagem amigável, tudo permanece na tela, botão tenta de novo. Duplo toque não repete. A conclusão só fecha a tela quando deu certo.
- Voltar/Esc/X, troca de tela e fechamento do aparelho: dirty guard e rascunho `base-tecnica` (somente texto; sem nome de quem recebeu, fotos ou valores).
- "Salvar sem concluir" também grava a Base Técnica. Falha de voz nunca apaga o texto (só acrescenta).
- Sem a 0111 o fluxo antigo (relato primeiro, 6 etapas) continua idêntico.

## 6. Compatibilidade e ordem de publicação

O frontend novo funciona num banco **sem** 0100–0111: leitura tolerante de `started_at`, painel e fechamento novos só aparecem quando as tabelas da 0111 existem, e o endpoint de IA devolve "indisponível" sem a migration. Ordem segura continua: **frontend novo → migrations 0100–0111 juntas, em ordem**. `api/work-order-report.js` só funciona depois da 0111 (falha fechada).

## 7. Decisões pendentes e roteiro (fora desta entrega)

- **Prioridade da OS:** não existe no produto (só o retorno tem prioridade). Não foi criada. *Decisão do dono:* se quiser, entra como campo da OS (normal/alta/urgente) com a mesma trava de UPDATE do técnico (`zt_guard_work_order_technician_update`) e ordenação opcional em Meu dia.
- **Assinatura presencial — PENDENTE.** Não existe. Projeto simples sugerido: traço no celular (canvas) na etapa de Confirmação, salvo como imagem no bucket privado `zt-work-orders` pela infraestrutura de `attachments` (categoria "Assinatura"), vinculada ao hash do texto do relatório; sem tabela nova nem arquitetura pública.
- **Assinatura por link de WhatsApp — SOMENTE DESIGN (não implementar sem nova autorização).** Requisitos de segurança:
  - token com 256 bits de CSPRNG, guardado **apenas como hash**; vale para **uma OS** e **uma versão** do relatório (hash do texto); se o texto mudar, o token é revogado;
  - expira (ex.: 72 h), é de uso único e revogável; reenviar invalida o anterior;
  - página pública mínima: empresa, número e data da OS e o texto do cliente; **sem** financeiro, endereço completo, outras OS ou dados de outras empresas; nada de dados pessoais na URL;
  - consumo atômico (`update … where used_at is null returning`) + `request_id`: replay não duplica; GET nunca muda estado; resposta igual para token inválido, expirado ou usado (sem enumeração); limite de tentativas por token e por IP;
  - o endpoint público usa uma RPC `SECURITY DEFINER` específica (nenhuma tabela exposta ao `anon`);
  - auditoria de eventos (criado, enviado, aberto, assinado, revogado, expirado) com carimbos e IP/UA truncados; retenção e base legal (LGPD) definidas antes.
- **Casos semelhantes (próxima onda):** busca por similaridade de causa/solução **dentro da mesma empresa** (FTS/`pg_trgm` ou embeddings, a decidir), técnico vendo só solução e dificuldade, nunca financeiro nem outra empresa. Hoje só a Base Técnica é estruturada.
- **Technical Intelligence V2 (roadmap, sem dashboard agora):** os dados já permitem causas frequentes, taxa de retorno (`work_order_returns`), distribuição de dificuldade, duração média (`completed_at − started_at`), soluções mais usadas e first-time fix rate (OS concluída sem retorno). Tudo por RPC só do proprietário, por empresa, com normalização de causa (taxonomia ou agrupamento) a decidir.

## 8. Rollback

- Frontend: reverter os commits `feat(field): technician mobile closeout…` e seguintes; o banco com a 0111 continua válido (tabelas só são lidas pelo app novo).
- 0111 (somente no H0/ensaio): `drop` das sete funções e das três tabelas; o frontend volta ao fluxo antigo sozinho (modo sem 0111). Nenhum dado de OS, financeiro ou estoque é tocado pela 0111.
