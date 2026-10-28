import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const legacy = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');
const runtimeApi = fs.readFileSync(new URL('../../src/lib/runtimeApi.js', import.meta.url), 'utf8');
const dataApi = fs.readFileSync(new URL('../../src/lib/dataApi.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/0111_field_execution_intelligence.sql', import.meta.url), 'utf8');

const HOJE = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const minutosAtras = (min) => new Date(Date.now() - min * 60000).toISOString();

const os = (patch = {}) => ({
  id: 'wo-1', numero: 'OS-0001', clienteId: 'c1', orcamentoId: null, status: 'agendada', data: HOJE, hora: '09:00',
  responsavelId: 'tech-1', local: 'Rua das Flores, 100', localServico: 'Portaria', descricaoLivre: 'Trocar fechadura',
  obs: '', itens: [{ id: 'i1', tipo: 'servico', nome: 'Troca de fechadura', qtd: 1, preco: 180, custo: 40, catalogoId: 's1' }],
  materiais: [], adicionais: [], valorAdicional: 0, descricaoAdicional: '', custosExtras: 0, pendencia: '', precisaRetorno: false,
  checklist: [], historico: [], fotos: [], relato: '', garantiaId: null, osOrigemId: null, emGarantia: false, iniciadaEm: null,
  ...patch,
});
const clientes = { c1: { id: 'c1', nome: 'Condomínio Aurora', whatsapp: '(11) 98888-7777' } };
const tecnico = (extra = {}) => ({
  ordens: [], orcamentos: [], lancamentos: [], produtos: [], servicos: [],
  nomeCliente: (id) => clientes[id]?.nome || 'Cliente', cliente: (id) => clientes[id],
  irPara: () => {}, abrirOS: () => {}, abrirOrc: () => {}, setTela: () => {}, setOrcamentoAberto: () => {}, mudarStatusOS: () => {},
  empresa: { temEquipe: true, responsavel: 'Dono' }, permitido: (chave) => chave !== 'financeiro' && chave !== 'verValores' && chave !== 'todasOS',
  usuarioAtual: { id: 'tech-1', nome: 'Téo Técnico' }, papel: 'tecnico', empresaId: 'company-1', real: false, aviso: () => {}, abrirV2: () => {},
  ...extra,
});

const limpar = (html) => html.replace(/<!-- -->/g, '');

test('Field Execution Intelligence V1 · telas do técnico', async (t) => {
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
  try {
    const mod = await vite.ssrLoadModule('/src/legacy/ZiisTecApp.jsx');
    const render = (Componente, props) => limpar(renderToStaticMarkup(React.createElement(Componente, props)));

    await t.test('Meu dia: cartão com cliente, local, horário, endereço, telefone, resumo e CTA, sem valores', () => {
      const html = render(mod.Inicio, tecnico({ ordens: [os()] }));
      assert.match(html, /Meus atendimentos de hoje/);
      assert.match(html, /Condomínio Aurora/);
      assert.match(html, /09:00/);
      assert.match(html, /OS-0001/);
      assert.match(html, /Portaria/);
      assert.match(html, /Rua das Flores, 100/);
      assert.match(html, /href="tel:11988887777"/);
      assert.match(html, /Trocar fechadura|Troca de fechadura/);
      assert.match(html, /Iniciar atendimento/);
      assert.doesNotMatch(html, /R\$|180|\bcusto\b|margem|prioridade/i, 'técnico não vê valores e a prioridade inexistente não é inventada');
    });

    await t.test('Meu dia: em andamento primeiro, depois horário marcado, depois as demais; CTA "Continuar atendimento" e tempo', () => {
      const ordens = [
        os({ id: 'a', numero: 'OS-0003', hora: '', status: 'agendada' }),
        os({ id: 'b', numero: 'OS-0002', hora: '15:00', status: 'agendada' }),
        os({ id: 'c', numero: 'OS-0001', hora: '16:30', status: 'andamento', iniciadaEm: minutosAtras(84) }),
        os({ id: 'd', numero: 'OS-0004', hora: '08:00', status: 'concluida' }),
      ];
      const html = render(mod.Inicio, tecnico({ ordens }));
      const posicao = (numero) => html.indexOf(numero);
      assert.ok(posicao('OS-0001') > -1 && posicao('OS-0001') < posicao('OS-0002') && posicao('OS-0002') < posicao('OS-0003'));
      assert.equal(posicao('OS-0004'), -1, 'concluída fica fora de Meu dia');
      assert.match(html, /Continuar atendimento/);
      assert.match(html, /Em atendimento · 1h 2[0-9]min|Em atendimento · 1h 24min/);
      assert.doesNotMatch(html, /em andamento há bastante tempo/);
    });

    await t.test('atendimento esquecido: aviso discreto no cartão e no detalhe, sem fechar nem alterar nada', () => {
      const velha = os({ status: 'andamento', iniciadaEm: minutosAtras(13 * 60) });
      const cartao = render(mod.Inicio, tecnico({ ordens: [velha] }));
      assert.match(cartao, /Este atendimento está em andamento há bastante tempo\. Confira se ele ainda está aberto\./);
      assert.match(cartao, /Em atendimento · 13h 0\dmin/);
      assert.match(cartao, /Continuar atendimento/);
      const detalhe = render(mod.OSDetalhe, {
        os: velha, ordens: [velha], cliente: (id) => clientes[id], nomeCliente: (id) => clientes[id].nome, setOsAberta: () => {}, mudarStatusOS: () => {},
        setOrdens: () => {}, servicos: [], produtos: [], orcamentos: [], setTela: () => {}, setOrcamentoAberto: () => {}, lancamentos: [], agendarOS: () => {},
        desagendarOS: () => {}, empresa: { temEquipe: false }, pedirConfirmacao: () => {}, garantias: [], finalizarOS: () => {}, abrirGarantia: () => {},
        abrirOS: () => {}, permitido: (c) => c === 'verValores' ? false : false, equipe: [], usuarioAtual: { id: 'tech-1', nome: 'Téo' }, real: false,
        empresaId: 'company-1', aviso: () => {}, papel: 'tecnico', resolverPrecificacao: () => {}, excluirRegistro: () => {},
      });
      assert.match(detalhe, /Em atendimento · 13h/);
      assert.match(detalhe, /Este atendimento está em andamento há bastante tempo/);
      assert.match(detalhe, /Finalizar atendimento/);
    });

    await t.test('cartão do dono em "O que tenho para hoje" continua como era (sem CTA novo)', () => {
      const html = render(mod.Inicio, tecnico({ ordens: [os()], papel: 'proprietario', permitido: () => true }));
      assert.match(html, /O que tenho para hoje/);
      assert.doesNotMatch(html, /Iniciar atendimento/);
    });

    await t.test('fechamento sem a 0111: o fluxo antigo continua (relato primeiro, sem Base Técnica)', () => {
      const html = render(mod.FinalizarAtendimento, { os: os({ status: 'andamento' }), onClose: () => {}, onFinalizar: () => {}, onSalvarParcial: () => {}, servicos: [], produtos: [], verValores: false, real: false });
      assert.match(html, /O que foi feito\?/);
      assert.doesNotMatch(html, /Causa encontrada|Base Técnica|Diagnóstico/);
    });

    await t.test('fechamento carregando: espera a consulta antes de montar as etapas', () => {
      const html = render(mod.FinalizarAtendimento, { os: os({ status: 'andamento' }), onClose: () => {}, onFinalizar: () => {}, onSalvarParcial: () => {}, servicos: [], produtos: [], verValores: false, real: true });
      assert.match(html, /Preparando o fechamento/);
      assert.match(html, /Carregando os dados do atendimento/);
    });

    const wizard = (etapaInicial, extra = {}) => render(mod.FinalizarAtendimento, {
      os: os({ status: 'andamento', iniciadaEm: minutosAtras(50), relato: 'Texto já escrito pelo técnico', fotos: [{ id: 'f1', nome: 'a.jpg', categoria: 'Antes' }, { id: 'f2', nome: 'b.jpg', categoria: 'Depois' }] }),
      onClose: () => {}, onFinalizar: () => {}, onSalvarParcial: () => {}, servicos: [], produtos: [], verValores: false, real: false,
      fechamentoInicial: 'disponivel', etapaInicial, ...extra,
    });

    await t.test('etapa 1 · Diagnóstico: causa, solução, dificuldade, necessita retorno e observação técnica, marcado como uso interno', () => {
      const html = wizard(0);
      assert.match(html, /Diagnóstico/);
      assert.match(html, /Uso interno da empresa\. Não aparece para o cliente\./);
      for (const rotulo of ['Causa encontrada', 'Solução aplicada', 'Nível de dificuldade', 'Fácil', 'Média', 'Difícil', 'Necessita retorno\\?', 'Observação técnica final']) {
        assert.match(html, new RegExp(rotulo), rotulo);
      }
      assert.match(html, /Etapa 1 de 7 · Diagnóstico/);
    });

    await t.test('etapa Evidências mostra quantas evidências já estão anexadas', () => {
      const html = wizard(2);
      assert.match(html, /Evidências do atendimento/);
      assert.match(html, /2 evidências anexadas/);
    });

    await t.test('etapa Relatório: texto editável com o que já existe, gerar com IA, texto padrão e aviso de que a IA não vê valores', () => {
      const html = wizard(5);
      assert.match(html, /Relatório do atendimento/);
      assert.match(html, /Texto já escrito pelo técnico/);
      assert.match(html, /Gerar relatório com IA/);
      assert.match(html, /Montar texto padrão/);
      assert.match(html, /não vê valores, custos nem as observações internas/);
      assert.match(html, /a OS pode ser concluída sem ele/);
      assert.doesNotMatch(html, /Descartar texto gerado/, 'nada gerado ainda: nada a descartar');
    });

    await t.test('relatório com retorno previsto: IA desligada e explicação, texto padrão continua', () => {
      const html = wizard(5);
      assert.doesNotMatch(html, /disabled=""[^>]*>[^<]*(<[^>]+>)*Gerar relatório com IA/);
    });

    await t.test('etapa Confirmação: quem recebeu ou responsável ausente, evidências e conclusão; sem valores para o técnico', () => {
      const html = wizard(6);
      assert.match(html, /Confirmação do atendimento/);
      assert.match(html, /Nome de quem recebeu o serviço/);
      assert.match(html, /Responsável ausente/);
      assert.match(html, /2 evidências anexadas/);
      assert.match(html, /Concluir atendimento/);
      assert.match(html, /Etapa 7 de 7 · Confirmação/);
      assert.doesNotMatch(html, /R\$|Total a cobrar/);
    });

    await t.test('Base Técnica na OS: painel somente leitura, só aparece com dados (sem dados ou sem banco real, nada)', () => {
      assert.equal(render(mod.BaseTecnicaPainel, { os: os(), real: true, recarregar: false }), '');
      assert.equal(render(mod.BaseTecnicaPainel, { os: os(), real: false, recarregar: false }), '');
    });
  } finally {
    await vite.close();
  }
});

test('contratos de código do fechamento técnico', () => {
  // Voz: um único componente de ditado, com botão "Ditar" nos quatro campos pedidos e sem segunda implementação.
  assert.equal((legacy.match(/rotuloVoz="Ditar"/g) || []).length, 4, 'causa, solução, observação técnica final e relatório');
  assert.equal((legacy.match(/useSpeechInput\(/g) || []).length, 1, 'só existe uma ligação com o reconhecimento de voz');
  assert.match(legacy, /iniciar\(\(t\) => onChange\(mergeDictation\(baseRef\.current, t\)\)\);/);
  assert.match(legacy, /onText: \(\{ text \}\) => \{ if \(text\) callbackRef\.current\?\.\(text\); \}/, 'falha ou silêncio nunca chama onChange');

  // Persistência: grava Base Técnica e confirmação ANTES da conclusão atômica; uma única conclusão.
  const concluir = legacy.slice(legacy.indexOf('const concluir = async () => {'), legacy.indexOf('const salvarSemConcluir'));
  assert.ok(concluir.indexOf('await salvarFechamento()') > -1 && concluir.indexOf('await salvarFechamento()') < concluir.indexOf('await onFinalizar(extras)'));
  assert.match(concluir, /if \(concluindo\) return;/, 'duplo toque não repete a conclusão');
  assert.match(concluir, /if \(falha\) \{ setErroFechamento\(falha\); return; \}/, 'falha ao salvar mantém tudo na tela');
  assert.equal((legacy.match(/finalizarOSDB\(/g) || []).length, 1, 'uma única chamada de conclusão atômica: nenhuma segunda lógica');
  assert.match(legacy, /const concluiu = await finalizarOS\(os\.id, extras\);\n\s+if \(concluiu === false\) return false;/);
  assert.match(legacy, /catch\(e\)\{ aviso\(mensagemErro\(e\)\); return false; \}/);
  const salvar = legacy.slice(legacy.indexOf('const salvarFechamento = async () => {'), legacy.indexOf('const aplicarRelatorio'));
  assert.match(salvar, /idsBase\.idFor\(limpa\)/);
  assert.match(salvar, /idsConfirmacao\.idFor\(/);
  assert.match(salvar, /if \(fechamento !== "disponivel"\) return "";/, 'banco sem 0111: nada a gravar e nada bloqueado');
  assert.match(salvar, /r\.unavailable\) \{ setFechamento\("indisponivel"\); return ""; \}/);

  // Dirty guard / Voltar / Esc / rascunho do mobile.
  assert.match(legacy, /const alterado = registroAlterado \|\| fechamentoAlterado;/);
  assert.match(legacy, /<Modal open onClose=\{onClose\} dirty=\{alterado\} busy=\{concluindo \|\| gerando\}/);
  assert.match(legacy, /useFormDraft\(\{ formType: "base-tecnica", enabled: real && !jaConcluida,/);
  assert.match(legacy, /if \(d\.workOrderId !== os\.id\) return;/, 'rascunho de outra OS nunca é restaurado');
  assert.match(fs.readFileSync(new URL('../../src/lib/formDrafts.js', import.meta.url), 'utf8'), /'base-tecnica': \['workOrderId', 'cause', 'solution', 'difficulty', 'learning', 'relato'\]/);

  // needs_return existente: "Necessita retorno?" liga o mesmo resultado "retorno" que já gera needs_return e work_order_returns.
  assert.match(legacy, /<SimNao valor=\{resultado === "retorno"\} onChange=/);
  assert.match(legacy, /precisaRetornar: resultado === "retorno",/);
  assert.doesNotMatch(migration.slice(migration.indexOf('create table if not exists public.work_order_technical_base'), migration.indexOf('alter table public.work_order_technical_base')), /needs_return|return_needed/);

  // Relógio: só leitura. Nada fecha OS por tempo e nenhum carimbo é escrito pelo front.
  const relogio = legacy.slice(legacy.indexOf('function useAgora('), legacy.indexOf('function CartaoMeuDia('));
  assert.doesNotMatch(relogio, /mudarStatusOS|finalizarOS|atualizarOSDB|setOrdens|started_at|completed_at/);
  assert.doesNotMatch(dataApi, /started_at/, 'WO_COLUMNS não pede started_at: o app novo funciona em banco sem a 0101 (Beta Live)');
  assert.match(runtimeApi, /\.eq\('status','in_progress'\)\.is\('deleted_at',null\)\.then\(\(r\)=>r,\(\)=>null\)/, 'leitura tolerante do started_at');
  assert.doesNotMatch(runtimeApi, /check\(st\)/);

  // Painel do técnico: nada de prioridade nem valores nos cartões.
  const cartao = legacy.slice(legacy.indexOf('function CartaoMeuDia('), legacy.indexOf('function BaseTecnicaPainel(')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(cartao, /brl\(|preco|custo|valorAdicional|prioridade|totalOS|cobranca/i);

  // Relatório: sem acesso direto do navegador ao provedor e sem segredo no front.
  const frontNovo = ['src/lib/workOrderReportApi.js', 'src/lib/technicalBaseApi.js', 'src/lib/fieldExecution.js']
    .map((arquivo) => fs.readFileSync(new URL(`../../${arquivo}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(frontNovo, /generativelanguage|api\.openai|api\.anthropic|GEMINI|OPENAI|ANTHROPIC|api[_-]?key|service[_-]?role/i);
  assert.match(frontNovo, /\/api\/work-order-report/);

  // Base Técnica nunca vai para o cliente: relatório do cliente e PDFs não leem a tabela interna.
  for (const arquivo of ['src/lib/quotePdf.js', 'src/lib/reciboPdf.js', 'api/quote-pdf.js']) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../../${arquivo}`, import.meta.url), 'utf8'), /technical_base|technicalBase|learning/, arquivo);
  }
});
