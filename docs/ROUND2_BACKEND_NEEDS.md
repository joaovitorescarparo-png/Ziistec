# ZiisTec — necessidades de backend identificadas na Rodada 2

Nenhuma migration, policy, RLS ou schema foi alterado nesta rodada. O item abaixo
foi implementado até onde o contrato atual permite e está documentado aqui para
revisão posterior.

---

## 1. Override de garantia por ordem de serviço

**Pedido (item 6 do mega prompt):** antes de concluir a OS, permitir desativar a
garantia daquele atendimento específico ou alterar o prazo somente para aquela
OS, sem mudar o prazo padrão do catálogo.

**Por que não foi feito:** a finalização usa a RPC
`zt_finalize_work_order_atomic`, chamada em `src/lib/dataApi.js`
(`finalizarOSDB`). O contrato aceita apenas:

```
p_wo, p_report, p_pending, p_extra_cost, p_due_days, p_materials, p_additions
```

Não há parâmetro para garantias. A criação das garantias acontece dentro da RPC,
a partir de `services.warranty_days` e `products.warranty_months`. Um override
por OS exigiria alterar a assinatura da função no banco — ou seja, migration.

**O que foi entregue no lugar:** antes da confirmação final, a OS mostra a seção
**Garantias deste atendimento** com o que será registrado — item, origem
(serviço ou fabricante), prazo e data final calculada a partir da data de
execução. É a mesma regra que o backend aplica, exibida para conferência, com a
indicação de que o prazo vem do catálogo e pode ser ajustado lá antes de
concluir. Itens com prazo zero continuam sem gerar garantia. Atendimento em
garantia continua sem gerar nova garantia.

**Menor mudança necessária, se for aprovada depois:**

- acrescentar um parâmetro opcional `p_warranties jsonb default null` a
  `zt_finalize_work_order_atomic`;
- formato sugerido:
  `[{ "item_id": uuid, "enabled": bool, "days": int|null, "months": int|null }]`;
- quando `null`, manter exatamente o comportamento atual (compatível com o app
  como está hoje);
- quando presente, aplicar override apenas naquela OS, sem tocar em
  `services.warranty_days` nem em `products.warranty_months`;
- validar dentro da função que o item pertence à OS e à empresa do chamador,
  preservando as checagens de autorização já existentes.

Enquanto isso não existir, o caminho para mudar um prazo continua sendo editar o
item em "Serviços e produtos" antes de concluir a ordem.

---

## 2. Observações sem impacto nesta rodada

- **Recibo/documento de cobrança:** foi gerado no navegador com `pdf-lib`, que já
  era dependência do projeto. Não foi criado endpoint, bucket nem tabela. Se no
  futuro o recibo precisar ser arquivado, aí sim será necessário decidir onde
  persistir (provável reuso de `attachments` + `zt-documents`).
- **Documentos de compra:** reaproveitados de `purchase.anexos`, que já chegam
  com URL assinada do bucket privado `zt-documents`. Nenhum storage novo.
- **NFS-e:** apenas o aviso "integração ainda não configurada". Nenhum botão
  falso, nenhuma chamada externa, nenhum certificado solicitado.
