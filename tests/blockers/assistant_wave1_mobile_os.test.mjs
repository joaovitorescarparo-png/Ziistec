import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import postcss from 'postcss';
import tailwind from 'tailwindcss';

const source = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');

test('OS renders long names, addresses, prices and reachable removal without truncating item content', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  try {
    const { OSDetalhe } = await vite.ssrLoadModule('/src/legacy/ZiisTecApp.jsx');
    const name = 'Instalação e configuração do equipamento ' + 'modelo'.repeat(25);
    const address = 'Avenida ' + 'endereço'.repeat(30);
    const os = { id: 'os', numero: 'OS-0006', clienteId: 'client', status: 'agendada', data: '2026-09-24', hora: '14:00',
      local: address, localServico: 'Bloco B', itens: [{ id: 'item', nome: name, qtd: 3, unidade: 'un', preco: 1200, custo: 0 }],
      adicionais: [], checklist: [], historico: [], fotos: [], custosExtras: 0 };
    const html = renderToStaticMarkup(React.createElement(OSDetalhe, {
      os, cliente: () => ({ nome: 'Cliente' }), nomeCliente: () => 'Cliente', permitido: () => true,
      orcamentos: [], lancamentos: [], garantias: [], ordens: [os], empresa: {}, equipe: [], papel: 'proprietario',
    }));
    assert.ok(html.includes(name));
    assert.ok(html.includes(address));
    assert.match(html, /whitespace-normal break-words[^>]*>Instalação/);
    assert.match(html, /3.600,00/);
    assert.match(html, /aria-label="Remover [^"]+" class="min-h-11 min-w-11/);
    assert.match(html, /flex-col items-stretch[^" ]*(?: [^"]+)?sm:flex-row/);
    assert.match(html, /max-w-full \[&amp;&gt;span\]:min-w-0/);
    assert.match(html, /flex flex-wrap justify-between items-baseline/);
  } finally { await vite.close(); }
});

test('compiled mobile styles stack items below 640px and reserve navigation plus safe area', async () => {
  // CSS compilation verifies these arbitrary classes produce actual rules. Visual
  // overflow at 320/360/375/390/430px still requires browser/Preview verification.
  const result = await postcss([tailwind({ content: [{ raw: source, extension: 'jsx' }], corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined });
  const css = result.css;
  assert.match(css, /\.flex-col\s*\{\s*flex-direction: column/);
  assert.match(css, /@media \(min-width: 640px\)/);
  assert.match(css, /\.sm\\:flex-row\s*\{\s*flex-direction: row/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /padding-bottom: calc\(7rem \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.min-h-11\s*\{\s*min-height: 2.75rem/);
  assert.match(css, /\.min-w-11\s*\{\s*min-width: 2.75rem/);
});
