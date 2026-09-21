import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const baseOS = (patch = {}) => ({
  id: 'wo-test',
  numero: 'OS-TESTE',
  clienteId: 'client-1',
  orcamentoId: null,
  status: 'aguardando',
  data: '',
  hora: '',
  responsavel: 'Owner Teste',
  responsavelId: 'owner-1',
  local: 'Rua Teste, 10',
  localServico: '',
  descricaoLivre: 'Diagnóstico de teste',
  obs: '',
  itens: [],
  materiais: [],
  adicionais: [],
  valorAdicional: 0,
  descricaoAdicional: '',
  custosExtras: 0,
  pendencia: '',
  precisaRetorno: false,
  pendentePrecificacao: false,
  checklist: [],
  historico: [],
  fotos: [],
  relato: '',
  garantiaId: null,
  osOrigemId: null,
  emGarantia: false,
  ...patch,
});

const osProps = (os) => ({
  os,
  cliente: () => ({ id: 'client-1', nome: 'Cliente Teste', fantasia: '' }),
  nomeCliente: () => 'Cliente Teste',
  setOsAberta: () => {},
  mudarStatusOS: () => {},
  setOrdens: () => {},
  servicos: [],
  produtos: [],
  orcamentos: os.orcamentoId ? [{ id: os.orcamentoId, numero: 'ORC-TESTE' }] : [],
  setTela: () => {},
  setOrcamentoAberto: () => {},
  lancamentos: [],
  ordens: [os],
  agendarOS: () => {},
  desagendarOS: () => {},
  empresa: { temEquipe: false },
  pedirConfirmacao: () => {},
  garantias: [],
  finalizarOS: () => {},
  abrirGarantia: () => {},
  abrirOS: () => {},
  permitido: () => true,
  equipe: [],
  usuarioAtual: { id: 'owner-1', nome: 'Owner Teste' },
  real: false,
  empresaId: 'company-1',
  aviso: () => {},
  papel: 'proprietario',
  resolverPrecificacao: () => {},
  excluirRegistro: () => {},
});

test('RC-1C.2 real legacy surfaces render without runtime ReferenceError', async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const mod = await vite.ssrLoadModule('/src/legacy/ZiisTecApp.jsx');
    const { OSDetalhe, OrcamentoEditor, aplicarOSSalvaNoEstado } = mod;

    await t.test('owner opens an unscheduled OS', () => {
      const os = baseOS();
      const html = renderToStaticMarkup(React.createElement(OSDetalhe, osProps(os)));
      assert.match(html, /OS-TESTE/);
      assert.match(html, /Sem agendamento/);
      assert.match(html, /Mais/);
    });

    await t.test('owner opens a scheduled quote-linked OS', () => {
      const os = baseOS({
        id: 'wo-scheduled',
        numero: 'OS-AGENDADA',
        orcamentoId: 'quote-1',
        status: 'agendada',
        data: '2026-09-22',
        hora: '09:30',
      });
      const html = renderToStaticMarkup(React.createElement(OSDetalhe, osProps(os)));
      assert.match(html, /OS-AGENDADA/);
      assert.match(html, /22\/09\/2026/);
      assert.match(html, /09:30/);
      assert.match(html, /Mais/);
    });

    await t.test('successful manual save transition updates list and opens detail id', () => {
      let ordens = [];
      let orcamentos = [{ id: 'quote-1', osId: null }];
      let osAberta = null;
      const setOrdens = (updater) => { ordens = typeof updater === 'function' ? updater(ordens) : updater; };
      const setOrcamentos = (updater) => { orcamentos = typeof updater === 'function' ? updater(orcamentos) : updater; };
      const setOsAberta = (id) => { osAberta = id; };
      const salvo = baseOS({ id: 'wo-state', numero: 'OS-STATE', orcamentoId: 'quote-1' });

      const id = aplicarOSSalvaNoEstado(salvo, { setOrdens, setOrcamentos, setOsAberta });

      assert.equal(id, 'wo-state');
      assert.equal(ordens.length, 1);
      assert.equal(ordens[0].id, 'wo-state');
      assert.equal(orcamentos[0].osId, 'wo-state');
      assert.equal(osAberta, 'wo-state');
    });

    await t.test('legacy OrcamentoEditor exposes thumbnail and ON/OFF PDF photo switch', () => {
      const produto = {
        id: 'product-1',
        nome: 'Motor garen 1/4 tsi',
        marca: 'Garen',
        modelo: 'TSI',
        unidade: 'unidade',
        preco: 900,
        custo: 600,
        ativo: true,
        imagemPath: 'company/product.jpg',
      };
      const item = {
        id: 'item-1',
        tipo: 'produto',
        catalogoId: produto.id,
        nome: produto.nome,
        unidade: 'unidade',
        qtd: 1,
        preco: 900,
        custo: 600,
        imagemPath: produto.imagemPath,
      };
      const common = {
        clientes: [{ id: 'client-1', nome: 'Cliente Teste', endereco: 'Rua Teste' }],
        servicos: [],
        produtos: [produto],
        empresa: { validadePadrao: 15, condicaoPadrao: 'Pix', observacaoPadrao: '', temEquipe: false },
        salvarOrcamento: async () => 'quote-1',
        salvarCliente: async () => 'client-1',
        salvarServico: async () => 'service-1',
        salvarProduto: async () => produto.id,
        onFechar: () => {},
        cliente: () => ({ id: 'client-1', nome: 'Cliente Teste' }),
        aviso: () => {},
      };
      const inicialOn = {
        id: 'quote-1', numero: 'ORC-0003', clienteId: 'client-1', status: 'rascunho',
        data: '2026-09-21', validade: '2026-10-06', itens: [item],
        desconto: 0, acrescimo: 0, condicao: 'Pix', obs: '', local: 'Rua Teste',
        localServico: '', osId: null, mostrarImagensProdutos: true,
      };
      const onHtml = renderToStaticMarkup(React.createElement(OrcamentoEditor, { ...common, inicial: inicialOn }));
      assert.match(onHtml, /Mostrar fotos dos produtos no PDF/);
      assert.match(onHtml, /Foto do produto vinculada/);
      assert.match(onHtml, /<input[^>]*type="checkbox"[^>]*checked=""|<input[^>]*checked=""[^>]*type="checkbox"/);

      const offHtml = renderToStaticMarkup(React.createElement(OrcamentoEditor, {
        ...common,
        inicial: { ...inicialOn, mostrarImagensProdutos: false },
      }));
      assert.match(offHtml, /Mostrar fotos dos produtos no PDF/);
      assert.doesNotMatch(offHtml, /<input[^>]*type="checkbox"[^>]*checked=""|<input[^>]*checked=""[^>]*type="checkbox"/);

      const novoHtml = renderToStaticMarkup(React.createElement(OrcamentoEditor, { ...common, inicial: null }));
      assert.match(novoHtml, /<input[^>]*type="checkbox"[^>]*checked=""|<input[^>]*checked=""[^>]*type="checkbox"/);
    });
  } finally {
    await vite.close();
  }
});
