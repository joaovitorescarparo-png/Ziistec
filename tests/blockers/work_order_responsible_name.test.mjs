import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Formato de fromWorkOrder: o banco devolve assigned_to (responsavelId), nunca o nome do responsável.
const osDoBanco = (patch = {}) => ({
  id: 'wo-db', numero: 'OS-0001', clienteId: 'client-1', orcamentoId: null, status: 'aguardando',
  data: '', hora: '', responsavelId: 'owner-1', local: 'Rua Teste, 10', localServico: '',
  descricaoLivre: 'Inspeção de teste', obs: '', itens: [], materiais: [], adicionais: [], valorAdicional: 0,
  descricaoAdicional: '', custosExtras: 0, pendencia: '', precisaRetorno: false, pendentePrecificacao: false,
  checklist: [], historico: [], fotos: [], relato: '', garantiaId: null, osOrigemId: null, emGarantia: false,
  ...patch,
});

const equipeComDono = [{
  id: 'm-owner', usuarioId: 'owner-1', empresaId: 'company-1', papel: 'proprietario', ativo: true,
  usuario: { id: 'owner-1', nome: 'Dono Teste' },
}];

const props = (os, extra = {}) => ({
  os, ordens: [os], osAberta: null,
  cliente: () => ({ id: 'client-1', nome: 'Cliente Teste', fantasia: '' }),
  nomeCliente: () => 'Cliente Teste',
  clientes: [{ id: 'client-1', nome: 'Cliente Teste' }],
  setOsAberta: () => {}, salvarOS: () => {}, mudarStatusOS: () => {}, setOrdens: () => {},
  servicos: [], produtos: [], orcamentos: [], setTela: () => {}, setOrcamentoAberto: () => {},
  lancamentos: [], agendarOS: () => {}, desagendarOS: () => {},
  empresa: { temEquipe: true, responsavel: '' },
  pedirConfirmacao: () => {}, garantias: [], finalizarOS: () => {}, abrirGarantia: () => {}, abrirOS: () => {},
  permitido: () => true, equipe: equipeComDono, usuarioAtual: { id: 'owner-1', nome: 'Dono Teste' },
  real: true, empresaId: 'company-1', aviso: () => {}, papel: 'proprietario',
  resolverPrecificacao: () => {}, excluirRegistro: () => {},
  ...extra,
});

test('responsável de OS carregada do banco aparece na lista e no detalhe', async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const { OrdensServico, OSDetalhe } = await vite.ssrLoadModule('/src/legacy/ZiisTecApp.jsx');
    const texto = (Componente, p) => renderToStaticMarkup(React.createElement(Componente, p)).replace(/<!-- -->/g, '');
    const agendada = { status: 'agendada', data: '2026-10-02', hora: '09:00' };

    await t.test('lista mostra o proprietário responsável', () => {
      const html = texto(OrdensServico, props(osDoBanco()));
      assert.match(html, /Sem agendamento · Dono Teste/);
      assert.doesNotMatch(html, /undefined/);
    });

    await t.test('detalhe agendado mostra o proprietário responsável', () => {
      assert.match(texto(OSDetalhe, props(osDoBanco(agendada))), /Responsável: Dono Teste/);
    });

    await t.test('técnico sem lista de equipe vê o próprio nome', () => {
      const html = texto(OSDetalhe, props(osDoBanco({ ...agendada, responsavelId: 'tech-1' }), {
        equipe: [], usuarioAtual: { id: 'tech-1', nome: 'Técnico Teste' }, papel: 'tecnico',
      }));
      assert.match(html, /Responsável: Técnico Teste/);
    });

    await t.test('responsável sem nome conhecido não vira undefined', () => {
      const html = texto(OrdensServico, props(osDoBanco({ responsavelId: 'outro-usuario' }), { equipe: [] }));
      assert.match(html, /Sem agendamento · Sem técnico/);
      assert.doesNotMatch(html, /undefined/);
    });
  } finally {
    await vite.close();
  }
});
