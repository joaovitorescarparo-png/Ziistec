# ZiisTec — MEGA PROMPT PARA FUSÃO VISUAL V1 + FUNCIONALIDADES V2

Você está trabalhando no repositório **joaovitorescarparo-png/Ziistec**, exclusivamente na branch **`ui-v1-v2-merge`**.

## MISSÃO

Não crie uma terceira versão do produto. Não redesenhe o ZiisTec do zero.

A direção correta é:

> **usar a aplicação antiga/primeiro módulo como base visual, de navegação e experiência do usuário, e incorporar nela as funcionalidades, segurança e regras de negócio já construídas na V2.**

O usuário gostou mais do visual e da organização do primeiro módulo (`src/legacy/ZiisTecApp.jsx`) e não gostou da sensação de entrar em um módulo V2 separado com telas que parecem uma aplicação paralela.

A V2 deve deixar de ser percebida como “outra área”. Ela deve virar evolução interna da aplicação principal.

---

# 1. REGRA DE OURO

**Preservar primeiro, melhorar depois.**

Ao alterar qualquer tela existente, mantenha:
- identidade visual original do primeiro módulo;
- sidebar escura;
- navegação original;
- tipografia, espaçamento, cards e densidade visual próximos do primeiro módulo;
- comportamento responsivo já existente;
- telas que já estavam boas;
- fluxo natural entre cliente → orçamento → OS → financeiro → garantia.

Evite transformar tudo em cards gigantes, landing page, dashboards isolados ou páginas que pareçam microsserviços separados.

O objetivo é parecer que o primeiro ZiisTec **amadureceu**, não que foi substituído.

---

# 2. ARQUITETURA QUE DEVE SER PRESERVADA

## Frontend
- React + Vite.
- `src/App.jsx` continua responsável por autenticação, sessão, tenant e gates.
- `src/legacy/ZiisTecApp.jsx` deve ser tratado como **shell/UI principal de referência**.
- Os arquivos em `src/screens/v2/` podem ser reutilizados como fonte de lógica/componentes, mas não precisam continuar existindo como páginas independentes se a função fizer mais sentido dentro da aplicação principal.

## Banco / segurança
Não reescreva Supabase.

As migrations e contratos V2 0050→0061 já foram criados e homologados em staging.

Não altere RLS, SECURITY DEFINER, schemas privados, custos protegidos ou migrations sem necessidade real.

**NÃO criar migration nova apenas para facilitar frontend.**

Se durante a fusão você perceber que falta campo ou RPC:
1. primeiro procure API/RPC já existente;
2. reutilize `src/lib/dataApi.js`, `dataApiExtras.js`, `v2Api.js`, `quoteV2Api.js`, `workOrderMemoryV2Api.js`, `settingsV2Api.js`, `financeAiV2Api.js`, `clientLocationsV2Api.js`, `storageExtras.js` etc.;
3. somente documente uma necessidade de backend se realmente impossível no contrato atual.

Não colocar service role no navegador.
Não mover custo privado para frontend do técnico.
Não enfraquecer RLS.

---

# 3. REMOVER A SENSAÇÃO DE “MÓDULO V2”

Hoje `src/App.jsx` possui:
- `AtalhoV2`;
- `WorkspaceV2Home`;
- query string `?v2=...`;
- diversas telas V2 abertas como aplicação paralela.

A nova experiência deve caminhar para:

- **um único ZiisTec**;
- sem botão flutuante “Abrir ZiisTec V2” no produto final;
- sem página inicial “Workspace V2” como hub separado;
- funcionalidades V2 aparecem dentro das abas antigas correspondentes.

Durante a transição é permitido manter rotas V2 escondidas para teste técnico, mas não devem ser o fluxo principal do usuário.

---

# 4. ORÇAMENTOS — PRIORIDADE MÁXIMA

Esta é a principal correção solicitada.

## O que NÃO pode acontecer
Não deixar orçamento dependente de IA.
Não obrigar o usuário a falar ou digitar um prompt para conseguir começar um orçamento.

## Comportamento desejado
Ao clicar **Novo orçamento**, abrir primeiro um formulário manual completo, semelhante ao fluxo antigo.

O usuário deve poder:
- selecionar cliente;
- cadastrar cliente sem sair do orçamento;
- adicionar serviço do catálogo;
- adicionar produto do catálogo;
- adicionar item livre;
- editar nome;
- editar quantidade;
- editar unidade;
- editar preço de venda;
- aplicar desconto;
- aplicar acréscimo;
- condição de pagamento;
- validade;
- observações;
- salvar rascunho;
- gerar PDF;
- enviar/compartilhar;
- aprovar/recusar/status;
- duplicar orçamento;
- converter orçamento aprovado em OS.

## IA deve ser assistente, não porta de entrada
Dentro do MESMO formulário manual, adicionar ação visível como:

**“Preencher com IA / voz”**

Essa ação pode abrir um painel/modal ou área expansível onde o usuário fala/digita algo como:

> “Orçamento para João, duas fechaduras Intelbras por 890 cada, instalação 400 e Pix na entrega.”

A IA interpreta e **preenche o formulário manual já aberto**.

Depois disso o usuário continua livre para editar tudo manualmente.

Não criar um documento separado de IA.
Não criar uma experiência “prompt → resultado final” sem edição normal.

## Voz
Adicionar microfone nos campos extensos:
- observações;
- descrição do item livre;
- descrição de serviço;
- instruções da IA.

## Cadastro rápido
Dentro do orçamento deve existir:
- “+ Cadastrar cliente”;
- “+ Cadastrar produto” quando necessário;
- “+ Cadastrar serviço” quando necessário.

Após cadastrar, o novo registro deve ficar selecionável imediatamente no orçamento.

---

# 5. CATÁLOGO — SERVIÇOS E PRODUTOS

O primeiro módulo já possui navegação **“Serviços e produtos”**. Preserve essa ideia.

Não obrigar o usuário a ir para um módulo V2 separado de estoque só para cadastrar um produto.

Criar dentro de “Serviços e produtos” uma experiência integrada, preferencialmente com abas:

- Serviços
- Produtos

## Serviço
Manter cadastro manual de:
- nome;
- categoria;
- descrição;
- unidade;
- preço;
- custo (owner only);
- garantia;
- retorno sugerido;
- ativo/inativo.

## Produto
Cadastro manual completo:
- foto;
- nome;
- marca;
- modelo;
- descrição;
- unidade;
- custo (owner only);
- preço de venda;
- garantia;
- venda habilitada;
- controla estoque;
- estoque atual;
- estoque mínimo;
- ativo/inativo.

Usar a lógica existente de `ProductStockV2.jsx` e APIs V2, mas incorporar ao visual principal.

Owner vê custo, margem, fornecedor/estoque completo.
Técnico nunca deve receber custo/margem/fornecedor em payload se não for permitido.

---

# 6. CLIENTES

Preservar a tela antiga de clientes porque ela possui boa leitura de:
- contato;
- histórico;
- valores;
- orçamentos;
- OS;
- garantias;
- locais atendidos.

Incorporar as melhorias V2 sem criar página separada de “clientes e locais”.

Adicionar ao cadastro/edição do cliente:
- endereço;
- Google Place ID quando disponível;
- latitude;
- longitude;
- maps_url;
- botão “Usar minha localização”;
- botão “Abrir no Google Maps”.

Quando uma OS usar o cliente/local, manter link rápido para Maps.

---

# 7. AGENDA

Preservar a agenda antiga, que visualmente está mais alinhada ao produto.

Garantir:
- visão Dia;
- Semana;
- Mês;
- próximos;
- concluídos;
- todos;
- histórico;
- busca;
- agendamento rápido;
- transformar/agendar OS;
- técnico vendo somente OS permitidas/atribuídas.

Não transformar agenda numa página cheia de KPIs se isso prejudicar leitura operacional.

---

# 8. ORDEM DE SERVIÇO — CENTRO OPERACIONAL

Preservar a experiência antiga de lista/detalhe de OS e incorporar a memória técnica V2.

A OS deve concentrar:
- cliente;
- endereço/Maps;
- data/hora;
- técnico;
- serviços/produtos;
- observações;
- histórico;
- status;
- checklist;
- venda de produto;
- materiais;
- relatório técnico por voz;
- evidências.

## Memória técnica
Dentro da própria OS, criar área clara de evidências:
- Antes;
- Durante;
- Depois;
- Equipamento;
- Vídeo;
- legenda curta.

Usar `attachments` + bucket privado `zt-work-orders` já existente.

## Técnico
O técnico deve ter ações simples, adequadas a campo:
- Confirmar feito;
- Vai ter que voltar;
- Finalizar.

Pode ditar relatório e observações.
Não deve ver:
- custo;
- margem;
- fornecedor;
- financeiro geral;
- assinatura;
- clientes em lista ampla;
- configurações comerciais do owner.

---

# 9. GARANTIAS E PÓS-VENDA

Preservar a tela antiga de garantias e incorporar:
- garantia manual;
- origem serviço/produto;
- série;
- local;
- datas;
- histórico;
- garantia expirada.

Para garantia expirada, ação:

**“Gerar orçamento pago”**

Isso deve abrir o MESMO editor manual de orçamento com contexto pré-preenchido.
A IA pode ajudar, mas orçamento continua editável manualmente.

---

# 10. PREVENTIVAS E CONTRATOS

Incorporar contratos/preventivas ao visual existente.

Contrato deve permitir:
- cliente;
- valor;
- periodicidade;
- cobertura;
- responsável;
- próxima visita;
- próxima cobrança;
- observações;
- gerar ciclo idempotente (OS + financeiro).

Não duplicar ciclo ao clicar duas vezes.
Usar RPC existente.

---

# 11. COMPRAS E ESTOQUE

Preservar o módulo Compras original e melhorar por dentro.

Compra deve:
- fornecedor;
- produtos/itens;
- quantidade;
- custo unitário;
- data;
- vencimento;
- pagamento;
- anexos/PDF de boleto;
- gerar/atualizar conta a pagar;
- aumentar estoque automaticamente;
- edição deve aplicar apenas a diferença;
- retry não pode duplicar estoque.

Usar o backend já homologado da V2.

---

# 12. FINANCEIRO

Preservar o visual e fluxo do Financeiro antigo e acrescentar V2 gradualmente.

Owner deve ter:
- receitas;
- despesas;
- receber;
- pagar;
- vencidos;
- lucro;
- margem;
- origem da receita/despesa;
- rentabilidade por OS;
- receita recorrente;
- fluxo de caixa 7/30/60 dias.

IA financeira deve ser botão/opção auxiliar, nunca substituir os números reais da tela.

Se custo ainda não estiver pronto para um cálculo, não inventar lucro/margem.

Técnico não acessa esta área.

---

# 13. CONFIGURAÇÕES

Preservar a tela de configuração antiga, usando dados reais.

Integrar:
- dados da empresa;
- logo;
- padrão de validade;
- condições de pagamento;
- observações padrão;
- equipe;
- assinatura;
- cancelar assinatura;
- reativar assinatura.

Não criar botão de checkout fictício.
Enquanto provedor de pagamento não estiver integrado, informar isso claramente.

---

# 14. EQUIPE E PERMISSÕES

Owner:
- acesso administrativo/comercial completo.

Technician:
- agenda permitida;
- próprias OS;
- dados mínimos dos clientes relacionados às próprias OS;
- catálogo seguro sem custos;
- venda de produto dentro da própria OS quando permitido;
- memória técnica;
- voz/fotos/vídeos.

Technician NÃO deve ter menu:
- Clientes (lista ampla);
- Financeiro;
- Compras;
- Configurações owner;
- Assinatura;
- custos/margens.

Não confie apenas em `display:none`; o backend/RLS já é autoridade e deve continuar sendo usado.

---

# 15. DASHBOARD / INÍCIO

Use o primeiro dashboard como base.

Melhorar sem exagerar:
- próximos atendimentos;
- OS recentes concluídas;
- orçamento pendente;
- contas a receber importantes;
- estoque baixo para owner;
- histórico recente.

Evitar “dashboard de BI” pesado para quem precisa trabalhar no celular em campo.

---

# 16. RESPONSIVIDADE

Prioridade prática:
1. iPhone;
2. tablet;
3. desktop.

A aplicação deve funcionar com toque, sem depender de hover.

Modais devem virar sheets/páginas adequadas no celular.
Botões principais precisam ser fáceis de tocar.
Não esconder ações essenciais atrás de menus pequenos.

---

# 17. VISUAL

Usar como referência principal o primeiro módulo:
- sidebar slate/preta;
- teal/verde como cor de ação;
- fundos claros;
- cards brancos;
- bordas suaves;
- pouco gradiente;
- minimalista profissional;
- aparência de software de gestão, não landing page.

Evitar:
- badges “V2” no produto final;
- textos técnicos sobre migration/banco para usuário final;
- banners enormes explicando segurança em cada página;
- telas com informação de implementação;
- repetição exagerada de cards KPI.

Segurança deve existir, não ficar sendo explicada visualmente o tempo inteiro.

---

# 18. REUSO DE CÓDIGO

Antes de reimplementar lógica, reaproveitar:
- `src/legacy/ZiisTecApp.jsx` para shell/UI/fluxos;
- `src/screens/v2/QuoteAIV2.jsx` para interpretação IA e validações;
- `src/screens/v2/ProductStockV2.jsx` para produto/estoque;
- `src/screens/v2/PurchasesV2.jsx` para compra/estoque;
- `src/screens/v2/WorkOrderMemoryV2.jsx` para memória técnica;
- `src/screens/v2/WorkOrderSaleV2.jsx` para venda em OS;
- `src/screens/v2/ManualWarrantyV2.jsx` para garantia manual;
- `src/screens/v2/MaintenanceContractsV2.jsx` para contrato;
- `src/screens/v2/FinanceV2.jsx` para cálculos/IA financeira;
- `src/screens/v2/SettingsV2.jsx` para configurações reais;
- `src/screens/v2/ClientLocationsV2.jsx` para localização;
- APIs existentes em `src/lib/`.

O objetivo é **absorver lógica V2 no shell antigo**, não copiar e manter duas versões em paralelo.

---

# 19. NÃO FAZER

Não:
- mexer na branch `main`;
- mexer diretamente em `product-v2-review`;
- remover migrations V2;
- desativar RLS;
- abrir `zt_private` para authenticated;
- colocar service role no frontend;
- transformar IA em obrigatória;
- apagar orçamento manual;
- apagar cadastro manual de produto/serviço;
- criar outro app/home V3;
- inventar dados demo como fallback em caminho autenticado real;
- criar pagamentos falsos;
- fundir tudo num arquivo gigantesco novo.

---

# 20. ESTRATÉGIA DE IMPLEMENTAÇÃO

Faça em etapas pequenas e compiláveis.

## Etapa A — unificação da navegação
- aplicação principal volta a ser a experiência padrão;
- V2 deixa de ser hub separado;
- esconder/remover `AtalhoV2` do fluxo final;
- preparar pontos de integração dentro do shell antigo.

## Etapa B — Orçamento unificado
Esta é a primeira grande entrega.
- restaurar editor manual como padrão;
- integrar IA/voz como preenchimento opcional do mesmo editor;
- cliente rápido;
- produto rápido;
- serviço rápido;
- PDF/status/duplicar/converter em OS.

## Etapa C — Catálogo unificado
- serviços;
- produtos;
- imagem;
- estoque;
- custos protegidos.

## Etapa D — Clientes + Maps e OS + memória técnica

## Etapa E — Compras, garantias, contratos, financeiro e configurações

Depois de cada etapa:
1. `npm run verify:v2`
2. `npm run build`
3. corrigir qualquer erro antes de seguir.

---

# 21. CRITÉRIO DE ACEITAÇÃO DO ORÇAMENTO

A primeira entrega só é aceitável se o seguinte fluxo funcionar:

1. Owner abre “Orçamentos”.
2. Clica “Novo orçamento”.
3. O formulário manual aparece imediatamente, sem IA obrigatória.
4. Seleciona ou cadastra cliente.
5. Adiciona um serviço.
6. Adiciona um produto.
7. Pode adicionar item livre.
8. Pode alterar quantidade e preço manualmente.
9. Pode falar uma instrução para IA e pedir “Preencher com IA”.
10. A IA modifica/preenche o mesmo formulário.
11. Usuário continua editando manualmente.
12. Salva rascunho.
13. Gera PDF.
14. Aprova.
15. Converte em OS sem duplicar OS ao repetir a ação.

Se esse fluxo não existir, a fusão ainda não está pronta.

---

# 22. ENTREGA ESPERADA DE VOCÊ

Trabalhe diretamente na branch `ui-v1-v2-merge`.

Primeiro faça uma leitura dos arquivos citados acima.
Depois implemente **Etapa A + Etapa B** antes de mexer nas demais.

Ao terminar cada etapa:
- informe arquivos alterados;
- explique decisões de arquitetura;
- informe o que foi realmente testado;
- não diga que testou browser/mobile se não testou;
- não aplique migration Supabase;
- não faça merge para `main`.

Se encontrar incompatibilidade de backend, documente exatamente:
- tabela/RPC faltante;
- payload esperado;
- motivo;
- menor mudança necessária.

O ChatGPT ficará responsável por revisar qualquer necessidade de Supabase, migrations, segurança, RLS e Vercel depois da sua entrega.

---

# DIREÇÃO FINAL

O usuário quer olhar para o ZiisTec e pensar:

> “É o sistema que eu já tinha gostado, só que agora muito mais completo.”

Não:

> “É um módulo V2 totalmente diferente do sistema antigo.”

Essa diferença é o objetivo principal desta refatoração.