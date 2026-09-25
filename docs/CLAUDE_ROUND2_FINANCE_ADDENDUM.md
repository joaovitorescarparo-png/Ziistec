# ZiisTec — Addendum da próxima rodada: Financeiro estilo Conta Azul

Este documento complementa `docs/CLAUDE_UI_V1_V2_MERGE_MEGA_PROMPT.md`.

## Objetivo

Evoluir o Financeiro do ZiisTec sem transformar o produto em um sistema contábil completo. A referência conceitual é uma experiência parecida com Conta Azul para pequenos prestadores: simples, operacional e integrada ao fluxo cliente → orçamento → OS → cobrança → documento → recebimento.

## 10ª melhoria — Financeiro mais completo

Preservar o visual atual do ZiisTec e acrescentar, de forma integrada:

### A. Contas a receber
- origem da cobrança: OS, orçamento, contrato ou lançamento manual;
- cliente;
- descrição;
- valor;
- vencimento;
- status: aberto, vencido, pago, cancelado;
- forma de pagamento;
- data do pagamento;
- anexos/documentos relacionados;
- ação rápida para WhatsApp;
- filtros por período, cliente, status e origem.

### B. Contas a pagar
- fornecedor/distribuidora;
- descrição;
- valor;
- vencimento;
- pago/não pago;
- data do pagamento;
- forma de pagamento;
- ligação opcional com uma Compra;
- anexos privados.

### C. Boleto/PDF de distribuidora
A infraestrutura atual de Compras já suporta anexos privados em `zt-documents`.

A UI deve permitir:
- anexar PDF/JPG/PNG/WEBP do boleto ou documento da distribuidora;
- visualizar nome do arquivo, vencimento e valor associado;
- abrir/baixar o anexo por URL assinada;
- marcar conta como paga;
- manter o documento ligado à compra/conta a pagar;
- nunca expor documentos financeiros ao papel technician.

Não armazenar arquivos financeiros em bucket público.

### D. Documento para o cliente
Adicionar uma área de documentos comerciais/financeiros gerados pelo ZiisTec.

Primeira etapa sem integração fiscal externa:
- gerar PDF de `Recibo`;
- gerar PDF de `Comprovante de serviço` / `Documento de cobrança`;
- número do documento;
- empresa/logotipo;
- cliente;
- CPF/CNPJ quando disponível;
- referência da OS/orçamento;
- itens/descrição do serviço;
- valor;
- forma de pagamento;
- data;
- observações;
- indicação visual clara: `DOCUMENTO NÃO FISCAL` quando não for uma nota fiscal oficial;
- baixar/compartilhar no WhatsApp.

Não chamar documento não fiscal de NFS-e/NF-e.

### E. Nota fiscal oficial — preparar, não simular
Não implementar uma falsa nota fiscal.

Criar apenas uma arquitetura/placeholder seguro para futura integração de NFS-e/NF-e, por exemplo:
- status fiscal: não emitida / pendente / emitida / cancelada;
- provider externo opcional;
- external_invoice_id;
- chave/número fiscal quando vier de provedor oficial;
- PDF/XML fiscal somente quando recebido de integração oficial.

A integração fiscal real deve ser tratada separadamente porque pode depender de prefeitura/provedor, certificado, credenciais e eventual custo externo.

Enquanto isso, usar somente Recibo/Documento de cobrança não fiscal.

### F. Visão de caixa
Melhorar a tela Financeiro preservando o estilo atual:
- Receber hoje;
- Pagar hoje;
- Vencidos;
- Recebidos no mês;
- Pagos no mês;
- Saldo projetado;
- fluxo de caixa 7/30/60 dias;
- receitas x despesas;
- rentabilidade por OS apenas quando custos reais estiverem disponíveis;
- contratos/receitas recorrentes.

Evitar dashboard pesado. Priorizar leitura rápida no celular/tablet.

### G. Navegação sugerida
Dentro de Financeiro, usar abas simples:
- Visão geral
- A receber
- A pagar
- Documentos

Compras continua sendo módulo operacional próprio, mas contas geradas por compras aparecem em `A pagar`.

### H. Regras de segurança
- Owner acessa Financeiro e documentos financeiros.
- Technician não deve receber payload de financeiro, custo, margem, fornecedor, boletos ou documentos financeiros.
- Reutilizar RLS e APIs existentes sempre que possível.
- Não enfraquecer ledger privado de custos.
- Não usar service role no navegador.
- Não criar migration sem necessidade real; documentar primeiro qualquer campo que realmente estiver faltando.

### I. Reutilizar o que já existe
Antes de criar código novo, verificar e reaproveitar:
- `financial_entries`;
- `purchases` / `purchase_items`;
- `src/lib/dataApi.js`;
- `src/lib/runtimeApi.js` (`uploadDocumentosCompraDB`);
- bucket privado `zt-documents`;
- geração/compartilhamento de PDF já utilizada em orçamento;
- Financeiro antigo como referência visual;
- FinanceV2 apenas como fonte de lógica quando útil.

### J. Ordem de implementação
Nesta rodada, priorizar UX/frontend e reuso do backend existente:
1. reorganizar Financeiro em Visão geral / A receber / A pagar / Documentos;
2. expor anexos de boleto/documento vinculados a compras/contas a pagar;
3. permitir geração de Recibo/Documento de cobrança não fiscal em PDF;
4. compartilhar/baixar documento;
5. somente depois documentar necessidade de backend para integração fiscal oficial.

Não alterar Supabase/RLS/migrations nesta rodada sem revisão específica.