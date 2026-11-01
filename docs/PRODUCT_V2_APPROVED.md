# ZiisTec Product V2 — escopo aprovado

Este arquivo congela as decisões da revisão de produto antes da implementação. A produção (`main`) não deve receber mudanças parciais deste escopo sem build, segurança e homologação.

## Dashboard
- Próximos serviços agendados com data, horário, cliente, técnico e local.
- Serviços concluídos recentemente e acesso ao histórico.
- Resumo operacional sem duplicar o histórico completo.

## Agenda
- Criar novo agendamento dentro da própria Agenda.
- Visões Hoje / Semana / Mês, com navegação rápida por mês/ano.
- Filtros Próximos / Concluídos / Todos.
- Histórico pesquisável por período, cliente, OS, endereço/local.
- Um dia deve listar todos os serviços feitos/agendados naquele dia.
- Agendamento rápido pode nascer antes de uma OS e depois ser convertido.

## Clientes e localização
- Localização selecionada por pesquisa Google Places/Maps, não apenas texto livre.
- Persistir endereço, Google Place ID, latitude, longitude e URL do Maps.
- OS herda a localização do cliente e oferece Abrir rota.

## OS e memória técnica
- Separar Em aberto / Agendadas / Serviços feitos.
- OS concluída vira memória/prova do atendimento.
- Guardar data/hora, local, técnico, relato, itens, materiais, garantia e histórico.
- Evidências com fotos e vídeos, organizáveis como Antes / Durante / Depois / Equipamento / Vídeo.
- Relatório técnico gerável a partir do atendimento.
- Histórico acessível por Agenda, cliente e busca de OS.

## Produtos, catálogo e estoque
- Produto com foto principal, marca/modelo, descrição, custo, preço de venda, garantia e estoque.
- Compra alimenta estoque; uso/venda em OS baixa estoque.
- Proprietário vê custo, venda e margem.
- Técnico vê catálogo comercial e preço de venda, nunca custo/margem/fornecedor.
- Técnico pode adicionar/vender produto durante atendimento.
- Alerta de estoque baixo.
- Produtos instalados podem compor ativos/histórico técnico do cliente.

## Orçamentos + IA
- Criar orçamento com IA como caminho principal, mantendo criação manual.
- Fluxo: falar -> interpretar -> conferir -> criar.
- IA identifica cliente, produtos, serviços, quantidades e valores.
- Se o usuário falar preço explicitamente, respeitar esse preço; caso contrário usar catálogo.
- Em correspondência incerta, pedir confirmação; não inventar produto/cliente.
- Item inexistente pode virar item livre e oferecer salvar no catálogo.
- Prévia editável antes de salvar.
- Duplicação rápida e modelos/kits de orçamento.
- Proprietário vê Venda / Custo / Margem estimada; cliente não vê custos.
- PDF pode exibir miniaturas dos produtos e ter apresentação visual profissional.

## Garantias, pós-venda e manutenção
- Garantia automática ao concluir OS quando serviço/produto possuir prazo.
- Também permitir Nova garantia manual para trabalhos anteriores.
- Garantia com cliente, local, produto/serviço, marca/modelo, serial opcional, início/fim, observações e evidências.
- Abrir atendimento em garantia ligado ao atendimento original, sem cobrança automática indevida.
- Linha do tempo de garantia/retornos.
- Pós-venda inteligente com oportunidades em 30/60 dias, 6 meses, 1 ano ou prazo configurado.
- Separar Garantia, Preventiva e Contratos.
- Preventiva avulsa e contratos recorrentes por cliente/condomínio/técnico.
- Contrato: valor recorrente, periodicidade, responsável, próxima visita, vencimento e status.
- Gerar/programar visitas preventivas e manter histórico.
- Problema fora do contrato pode marcar Necessita orçamento e alimentar orçamento por IA.

## Compras
- Compras continuam representando fornecedor, custo, vencimento, documentos e conta a pagar.
- Conectar itens comprados ao catálogo/estoque quando aplicável.

## Financeiro empresarial
- Dashboard financeiro mensal: Faturamento, Recebido, A receber, Despesas, Lucro estimado, Margem e Em atraso.
- Diferenciar faturamento, caixa recebido e lucro.
- Receitas x despesas x resultado por mês.
- Resultado por origem: serviços, produtos e contratos recorrentes.
- Rentabilidade por OS: venda, custo de produtos/materiais, demais custos, lucro e margem.
- Receita recorrente mensal, contratos ativos, próximos vencimentos e inadimplência.
- Fluxo de caixa projetado para 7/30/60 dias.
- Resumo financeiro por IA como evolução, sempre baseado em dados reais.

## Configurações
- Organizar em Empresa; Orçamentos e documentos; Equipe e permissões; Catálogo e vendas; Agenda e atendimento; Garantia e pós-venda; Financeiro; Integrações; Assinatura ZiisTec.
- Só expor configurações que alterem comportamento real.

## Princípios
- Produto orientado a prestador em campo, com poucos cliques e forte uso de voz/IA.
- Não virar ERP genérico cheio de abas sem valor.
- Segurança/RLS multiempresa e permissões por função permanecem obrigatórias.
- Produção só recebe a V2 depois de migrations, build, testes de fluxo, segurança e preview passarem.
