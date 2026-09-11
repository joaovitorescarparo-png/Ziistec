# ZiisTec — CLAUDE ROUND 2 MEGA PROMPT

Você está trabalhando somente no projeto ZiisTec e deve preservar a direção visual aprovada da branch `ui-v1-v2-merge`.

## MISSÃO

Esta rodada NÃO é um redesign. O usuário aprovou a direção visual da fusão V1 + V2 e quer apenas melhorias de experiência e financeiro.

Use `src/legacy/ZiisTecApp.jsx` como shell visual principal e mantenha o sistema com aparência de software de gestão simples, profissional e rápido para uso em campo.

## REGRAS INEGOCIÁVEIS

- Não criar nova aplicação paralela.
- Não voltar a expor um hub "V2".
- Não alterar Supabase schema, migrations, RLS, SECURITY DEFINER ou policies.
- Não alterar Vercel.
- Não inserir service role, secret ou chave privada no frontend.
- Não enfraquecer separação owner/technician.
- Técnico não pode receber custo, margem, fornecedor ou financeiro amplo.
- Reutilizar APIs já existentes antes de criar qualquer lógica nova.
- Se realmente faltar backend, documentar em `docs/ROUND2_BACKEND_NEEDS.md` em vez de inventar migration.
- Manter `npm run verify:v2` verde.
- Manter `npm run build` verde.
- Não remover guards de staging/produção.

---

# 1. ORÇAMENTO — PÓS-CRIAÇÃO MAIS ÚTIL

Hoje o formulário manual deve continuar sendo o fluxo padrão.

Ao clicar `Criar orçamento`, NÃO baixar PDF automaticamente.

Depois de salvar com sucesso, exibir uma confirmação clara como:

**Orçamento ORC-XXXX criado**

Ações imediatas:
- `Ver orçamento`
- `Gerar PDF`
- `Enviar pelo WhatsApp`
- `Continuar depois`

O usuário não deve ser obrigado a abrir novamente a lista só para gerar PDF.

Reutilizar `baixarOrcamentoPDF`, `compartilharOrcamentoPDF` e a lógica atual de WhatsApp.

Não gerar PDF de dados ainda não salvos. O PDF deve continuar vindo do orçamento persistido.

---

# 2. ORÇAMENTO — RESUMO E CTA NO TABLET/CELULAR

Melhorar a composição sem trocar o estilo.

Em telas pequenas/tablet, considerar uma barra de ação inferior ou resumo sticky discreto com:
- Total do orçamento
- `Criar orçamento` / `Salvar alterações`

Não esconder campos importantes.
Não transformar a página em card gigante.

---

# 3. ORÇAMENTO — ADIÇÃO DE ITENS MAIS RÁPIDA

Ao escolher serviço/produto no catálogo dentro do orçamento:
- adicionar rapidamente;
- permitir `- / quantidade / +`;
- editar preço de venda;
- remover item;
- preservar `Item livre` simples e rápido.

Não obrigar o usuário a cadastrar tudo no catálogo.

---

# 4. CADASTRO RÁPIDO DENTRO DO ORÇAMENTO

O cadastro rápido de serviço/produto deve continuar sem tirar o usuário do orçamento, mas precisa aceitar garantia.

Para serviço:
- nome;
- preço;
- custo owner-only;
- unidade;
- `Tem garantia? Sim/Não`;
- se Sim: prazo em dias, com atalhos 30/60/90/180/365 e personalizado.

Para produto:
- nome;
- marca/modelo quando útil;
- preço;
- custo owner-only;
- unidade;
- `Tem garantia? Sim/Não`;
- se Sim: prazo em meses.

Após salvar, adicionar/selecionar imediatamente o novo item no orçamento.

---

# 5. FINALIZAÇÃO DA OS — FLUXO MAIS CLARO

Transformar a finalização em um fechamento operacional claro, mantendo a lógica atual.

Antes de finalizar, mostrar um resumo com:
- Relatório técnico
- Materiais/produtos utilizados
- Fotos/evidências
- Valores adicionais permitidos
- Pendência/retorno
- Garantia gerada
- Valor financeiro a receber

Para técnico, manter o fluxo simples e sem custo/margem.

Ações de resultado devem ficar muito claras:
- `Finalizado`
- `Precisa retornar`
- `Não finalizado`

Não alterar a segurança do RPC de finalização.

---

# 6. GARANTIA — AUTOMÁTICA COMO PADRÃO, MAS OPCIONAL NA OS

A garantia do catálogo continua sendo a configuração padrão.

Exemplo:
- Serviço cadastrado com 90 dias → ao finalizar uma OS, sugerir 90 dias.
- Produto cadastrado com 12 meses → sugerir 12 meses.

Mas antes da confirmação final da OS, mostrar uma seção:

**Garantias deste atendimento**

Exemplo:
- ☑ Instalação de fechadura — 90 dias — até DD/MM/AAAA
- ☑ Fechadura Intelbras — 12 meses — até DD/MM/AAAA

Permitir:
- desativar a garantia para aquele atendimento específico;
- alterar o prazo somente para aquela OS;
- não mudar o prazo padrão do catálogo ao editar somente a OS.

Se o backend atual não permitir override por OS sem migration, NÃO criar migration. Nesse caso:
1. manter o comportamento automático já existente;
2. implementar a melhor UX possível com o contrato atual;
3. documentar o backend necessário em `docs/ROUND2_BACKEND_NEEDS.md`.

Nunca gerar garantia para serviço/produto configurado com prazo zero, salvo ação explícita do owner suportada pelo backend existente.

---

# 7. GARANTIA — LEITURA MAIS CLARA

Na tela de garantia, reforçar:
- cliente;
- origem (serviço/produto);
- OS original;
- data inicial;
- data final;
- prazo restante;
- número de série quando existir;
- local;
- status Ativa/Expirada.

Para garantia expirada, preservar `Gerar orçamento pago` levando ao mesmo editor manual de orçamento.

---

# 8. RESPONSIVIDADE / ESPAÇAMENTO

A direção visual atual está aprovada.

Melhorar somente:
- aproveitamento de área branca em tablet;
- hierarquia dos botões principais;
- ações touch-friendly;
- modais confortáveis no celular;
- evitar informações importantes longe demais do botão principal.

Prioridade: tablet e celular em campo.

Não mudar paleta, sidebar ou identidade geral.

---

# 9. FINANCEIRO — EXPERIÊNCIA OPERACIONAL TIPO CONTA AZUL

Não copiar Conta Azul inteiro. Trazer somente o que é útil para prestador/instalador.

Dentro do Financeiro principal, organizar preferencialmente em abas:
- `Visão geral`
- `A receber`
- `A pagar`
- `Documentos`

## Visão geral
Mostrar com dados reais existentes:
- saldo/resultado do período quando suportado;
- recebido no mês;
- pago no mês;
- a receber;
- a pagar;
- vencidos;
- fluxo projetado 7/30/60 dias;
- origem OS/compra/manual;
- rentabilidade/margem somente quando custos estiverem realmente disponíveis.

Não inventar lucro/margem.

## A receber
Lista prática com:
- cliente;
- descrição;
- origem OS/orçamento/manual;
- valor;
- vencimento;
- vencido ou em dia;
- pago/não pago;
- forma de pagamento;
- ações: abrir origem, marcar pago, gerar documento/recibo, WhatsApp quando aplicável.

## A pagar
Lista prática com:
- fornecedor;
- compra relacionada;
- valor;
- vencimento;
- status;
- documentos anexados;
- ação `Abrir boleto/documento`;
- marcar como pago quando permitido.

Compras já possuem anexos privados em `zt-documents`. Reutilizar `purchase.anexos`/`uploadDocumentosCompraDB`; não criar storage novo.

## Documentos
Criar visão operacional dos documentos disponíveis a partir dos dados existentes:
- boletos/PDFs/imagens anexados às compras;
- documentos/recibos que podem ser gerados sob demanda para contas a receber/OS.

Não persistir um novo tipo de documento em banco se não houver estrutura atual para isso. É aceitável gerar documento sob demanda a partir da OS/lancamento existente.

---

# 10. DOCUMENTO PARA CLIENTE — RECIBO / COBRANÇA, NÃO NOTA FISCAL

Adicionar uma ação no financeiro/OS para gerar um PDF profissional para o cliente.

Nome sugerido:
- `Recibo`
- ou `Documento de cobrança`

Deve conter quando disponível:
- logo da empresa;
- nome/razão social da empresa;
- CPF/CNPJ da empresa;
- cliente;
- CPF/CNPJ do cliente;
- número do documento;
- OS/orçamento relacionado;
- itens/resumo do serviço;
- valor;
- vencimento ou data de pagamento;
- forma de pagamento;
- observações;
- data de emissão.

DEVE trazer claramente:

**DOCUMENTO NÃO FISCAL**

Não chamar isso de NF-e, NFS-e, nota fiscal, DANFE ou documento fiscal.

Ações:
- `Gerar PDF`
- `Compartilhar/Enviar pelo WhatsApp` quando suportado.

Se houver estrutura suficiente, reutilizar padrão visual/infra do PDF de orçamento.

## NFS-e futura
Somente preparar visualmente um espaço discreto como:
`Nota fiscal: integração ainda não configurada`.

Não criar botão falso que finge emitir NFS-e.
Não chamar API externa.
Não adicionar serviço pago.
Não pedir certificado nesta rodada.

---

# CRITÉRIOS DE ACEITAÇÃO

A rodada só está concluída se:

1. O orçamento continua manual-first.
2. IA/voz continua opcional.
3. Criar orçamento oferece PDF/WhatsApp logo após salvar sem download automático.
4. Cadastro rápido permite definir garantia sem sair do orçamento.
5. Finalização da OS mostra garantia de forma clara e sem expor custos ao técnico.
6. Garantia permanece opcional conforme o catálogo/contrato atual.
7. Financeiro tem Visão geral / A receber / A pagar / Documentos.
8. Boleto PDF de compra aparece e pode ser aberto no financeiro usando anexos já existentes.
9. É possível gerar Recibo/Documento de cobrança NÃO FISCAL para cliente sem fingir nota fiscal.
10. Técnico continua sem acesso ao financeiro geral, custos, margens e fornecedores.
11. Nenhuma migration/RLS/schema foi alterado.
12. `npm run verify:v2` passa.
13. `npm run build` passa.

---

# COMO ENTREGAR

Trabalhe diretamente sobre os arquivos deste pacote, sem Git obrigatório.

Antes de terminar:
- rode `npm ci`;
- rode `npm run verify:v2`;
- rode `npm run build`;
- corrija erros;
- não inclua `node_modules` no ZIP final;
- devolva um ZIP completo do projeto alterado;
- inclua `CLAUDE_ROUND2_CHANGELOG.md` na raiz descrevendo arquivos alterados, o que foi implementado e qualquer necessidade de backend que não pôde ser feita sem migration/RLS.

Não faça alterações fora do escopo acima.