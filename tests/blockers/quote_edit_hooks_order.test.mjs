import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';

// O React exige a mesma sequência de hooks em todo render da mesma instância;
// render com menos hooks é o erro minificado #300 (tela branca). Sem DOM de teste
// no projeto, este harness renderiza um único componente pelo dispatcher do
// React 18 (versão fixada no package.json) e registra a sequência de hooks.
const internos = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

function instanciaComHooks(Componente, props) {
  assert.ok(internos?.ReactCurrentDispatcher, 'harness depende do dispatcher interno do React 18');
  const slots = [];
  return () => {
    const hooks = [];
    const slot = (tipo, criar) => {
      const indice = hooks.push(tipo) - 1;
      if (!(indice in slots)) slots[indice] = criar();
      return slots[indice];
    };
    const dispatcher = {
      useState(inicial) {
        const estado = slot('useState', () => ({ valor: typeof inicial === 'function' ? inicial() : inicial }));
        return [estado.valor, (proximo) => { estado.valor = typeof proximo === 'function' ? proximo(estado.valor) : proximo; }];
      },
      useRef: (inicial) => slot('useRef', () => ({ current: inicial })),
      useMemo: (criar) => { slot('useMemo', () => null); return criar(); },
      useCallback: (fn) => { slot('useCallback', () => null); return fn; },
      useEffect: () => { slot('useEffect', () => null); },
      useLayoutEffect: () => { slot('useLayoutEffect', () => null); },
      useContext: (contexto) => contexto._currentValue,
    };
    const anterior = internos.ReactCurrentDispatcher.current;
    internos.ReactCurrentDispatcher.current = dispatcher;
    try {
      const elemento = Componente(props);
      return { elemento, hooks };
    } finally {
      internos.ReactCurrentDispatcher.current = anterior;
    }
  };
}

const acharBotao = (no, texto) => {
  if (Array.isArray(no)) return no.reduce((achado, filho) => achado || acharBotao(filho, texto), null);
  if (!no || typeof no !== 'object' || !no.props) return null;
  if (no.props.children === texto && typeof no.props.onClick === 'function') return no;
  return acharBotao(no.props.children, texto);
};

test('orçamento salvo: Editar e voltar mantêm a mesma sequência de hooks (React #300)', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const { OrcamentoDoc, OrcamentoEditor } = await vite.ssrLoadModule('/src/legacy/ZiisTecApp.jsx');
    const orc = {
      id: 'quote-1', empresaId: 'company-1', numero: 'ORC-0001', clienteId: 'client-1', status: 'rascunho',
      data: '2026-10-02', validade: '2026-10-17', desconto: 10, acrescimo: 5, condicao: 'Pix', obs: '',
      local: 'Rua Teste, 10', localServico: '', osId: null,
      itens: [{ id: 'item-1', tipo: 'servico', nome: 'Serviço de teste', unidade: 'unidade', qtd: 3, preco: 100 }],
    };
    const renderizar = instanciaComHooks(OrcamentoDoc, {
      orc,
      cliente: () => ({ id: 'client-1', nome: 'Cliente Teste', fantasia: '' }),
      empresa: { nome: 'Empresa Teste', atividade: '', documento: '', telefone: '', endereco: '' },
      papel: 'proprietario',
      mudarStatusOrc: async () => {},
      duplicarOrcamento: () => {},
      gerarOS: () => {},
      setOrcamentoAberto: () => {},
      aviso: () => {},
      pedirConfirmacao: () => {},
      excluirRegistro: () => {},
    });

    const documento = renderizar();
    const editar = acharBotao(documento.elemento, 'Editar');
    assert.ok(editar, 'documento do orçamento salvo exibe Editar');

    editar.props.onClick();
    const editor = renderizar();
    assert.deepEqual(editor.hooks, documento.hooks, 'Editar não pode renderizar menos hooks (React #300)');
    assert.equal(editor.elemento.type, OrcamentoEditor, 'Editar abre o editor de orçamento');
    assert.equal(editor.elemento.props.inicial, orc, 'editor recebe o orçamento salvo');

    editor.elemento.props.onFechar();
    const deVolta = renderizar();
    assert.deepEqual(deVolta.hooks, documento.hooks, 'fechar o editor mantém a sequência de hooks');
    assert.ok(acharBotao(deVolta.elemento, 'Editar'), 'fechar o editor volta ao documento');
  } finally {
    await vite.close();
  }
});
