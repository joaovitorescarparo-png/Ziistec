import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pdfLib from 'pdf-lib';
import {
  gerar, png, jpeg, item, empresaBase, clienteBase, orcamentoBase, textos, acharTexto, contemTexto, semSobreposicao,
  MARGEM, DIREITA, TOPO, LOGO_CAIXA, SAFE_BOTTOM, COMPANY,
} from './support/quote-pdf-harness.mjs';

/*
  Redesign do PDF do orçamento (2026-11). Mesmo código na Vercel (/api/quote-pdf) e na Edge Function.

  O PDF tem de se defender de logo ruim: a logo aparece SÓ no cabeçalho, contida numa caixa de
  112 × 52 pt (proporção preservada, nunca esticada, nunca no tamanho natural, nunca como fundo).
  Logo inválida, WEBP, pesada demais ou ausente: só o nome da empresa. Nenhum texto sobre outro,
  nada fora das margens, nada invadindo o rodapé; tabela paginada sem cortar linha.
*/

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const comLogo = (bytes, tipo) => ({ empresa: { ...empresaBase(), logo_path: `${COMPANY}/logo` }, objetos: { [`zt-branding/${COMPANY}/logo`]: [tipo, bytes] } });
const pdfValido = async (r, rotulo) => {
  assert.equal(r.status, 200, rotulo);
  assert.equal(r.tipo, 'application/pdf', rotulo);
  assert.equal(r.bytes.subarray(0, 5).toString('latin1'), '%PDF-', rotulo);
  return pdfLib.PDFDocument.load(r.bytes);
};
const semProblemas = (r, rotulo) => assert.deepEqual(semSobreposicao(r), [], rotulo);

// ─────────────────────────── 1. logo: só no cabeçalho, contida, sem fundo

const LOGOS = {
  'PNG transparente (3:1)': [png(300, 100, { alfa: true }), 'image/png', 300 / 100],
  'JPG com fundo, vertical, pesado (como a logo antiga da JS Connect)': [jpeg(700, 1000, 980 * 1024), 'image/jpeg', 700 / 1000],
  'logo quadrada': [png(200, 200), 'image/png', 1],
  'logo 4:1 horizontal': [png(400, 100), 'image/png', 4],
  'logo 1:4 vertical': [png(100, 400), 'image/png', 1 / 4],
  'imagem 4000×3000': [jpeg(4000, 3000, 200 * 1024), 'image/jpeg', 4 / 3],
  'JPG rotulado como PNG no Storage': [jpeg(600, 300), 'image/png', 2],
};
const SEM_LOGO = {
  'imagem inválida (bytes que não são imagem)': [Buffer.from('isto não é uma imagem de verdade'), 'image/png'],
  'PNG truncado': [png(120, 60).subarray(0, 40), 'image/png'],
  'WEBP': [Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ' + 'x'.repeat(64), 'latin1'), 'image/webp'],
  'JPG acima de 1,5 MB': [jpeg(3000, 2000, 1.6 * 1024 * 1024), 'image/jpeg'],
  'JPG com dimensão zero': [jpeg(0, 0), 'image/jpeg'],
};

test('Logo válida: desenhada uma única vez, só no cabeçalho, contida na caixa, sem fundo e sem texto por cima', async () => {
  for (const [nome, [bytes, tipo, proporcao]] of Object.entries(LOGOS)) {
    const r = await gerar(comLogo(bytes, tipo));
    await pdfValido(r, nome);
    const imagens = r.paginas.flatMap((p, i) => p.imagens.map((im) => ({ ...im, pagina: i })));
    assert.equal(imagens.length, 1, `${nome}: uma imagem só (a logo)`);
    const logo = imagens[0];
    assert.equal(logo.pagina, 0, `${nome}: só na primeira página`);
    assert.equal(logo.opacity, undefined, `${nome}: sem transparência de marca-d'água`);
    // Dentro da caixa do cabeçalho.
    assert.ok(logo.x >= MARGEM - 0.01 && logo.x + logo.width <= MARGEM + LOGO_CAIXA.width + 0.01, `${nome}: largura dentro da caixa`);
    assert.ok(logo.y >= TOPO - LOGO_CAIXA.height - 0.01 && logo.y + logo.height <= TOPO + 0.01, `${nome}: altura dentro da caixa`);
    // Contain: proporção preservada e um dos lados encosta na caixa (nunca esticada, nunca natural).
    assert.ok(Math.abs(logo.width / logo.height - proporcao) / proporcao < 0.01, `${nome}: proporção preservada`);
    assert.ok(Math.abs(logo.width - LOGO_CAIXA.width) < 0.01 || Math.abs(logo.height - LOGO_CAIXA.height) < 0.01, `${nome}: aproveita a caixa`);
    assert.ok(logo.width <= LOGO_CAIXA.width + 0.01 && logo.height <= LOGO_CAIXA.height + 0.01, `${nome}: nunca no tamanho natural`);
    // Nenhum texto sobre a logo; o nome da empresa começa depois dela.
    for (const t of r.paginas[0].textos) {
      const sobre = Math.min(t.x2, logo.x + logo.width) - Math.max(t.x, logo.x) > 0.5 && Math.min(t.alto, logo.y + logo.height) - Math.max(t.baixo, logo.y) > 0.5;
      assert.equal(sobre, false, `${nome}: "${t.text}" sobre a logo`);
    }
    const nomeEmpresa = acharTexto(r, 'Js Connect Climatização');
    assert.ok(nomeEmpresa && nomeEmpresa.x >= logo.x + logo.width + 10, `${nome}: nome da empresa ao lado da logo`);
    // A imagem entra uma vez no arquivo: nada de multiplicar o tamanho.
    assert.ok(r.bytes.length <= bytes.length + 60 * 1024, `${nome}: PDF de ${r.bytes.length} bytes para logo de ${bytes.length}`);
    semProblemas(r, nome);
  }
});

test('Logo inválida, truncada, WEBP, pesada demais ou com dimensão zero: sem imagem, só o nome da empresa', async () => {
  for (const [nome, [bytes, tipo]] of Object.entries(SEM_LOGO)) {
    const r = await gerar(comLogo(bytes, tipo));
    await pdfValido(r, nome);
    assert.equal(r.paginas.flatMap((p) => p.imagens).length, 0, `${nome}: nenhuma imagem`);
    assert.equal(acharTexto(r, 'Js Connect Climatização')?.x, MARGEM, `${nome}: nome na margem`);
    assert.ok(r.bytes.length < 40 * 1024, `${nome}: arquivo pequeno (${r.bytes.length})`);
    semProblemas(r, nome);
  }
  const semLogo = await gerar();
  await pdfValido(semLogo, 'sem logo');
  assert.equal(semLogo.paginas.flatMap((p) => p.imagens).length, 0);
  assert.equal(acharTexto(semLogo, 'Js Connect Climatização')?.x, MARGEM);
});

// ─────────────────────────── 2. fixtures A–G

test('A. Orçamento simples: cabeçalho, cliente, tabela, total e rodapé; nada vazio aparece', async () => {
  const r = await gerar({ itens: [item(1, { name: 'Limpeza de split 12.000 BTU', kind: 'service', unit: 'serviço', quantity: 1, unit_price: 300 })] });
  const doc = await pdfValido(r, 'A');
  assert.equal(doc.getPageCount(), 1);
  for (const t of ['ORÇAMENTO', 'Nº ORC-0042', 'Emissão 27/11/2026', 'Validade 12/12/2026', 'CLIENTE', 'Condomínio Aurora', 'Documento: 98.765.432/0001-10',
    'Contato: Síndica Ana', 'Telefone: 11 3000-0000', 'LOCAL / REFERÊNCIA', 'PRODUTOS E SERVIÇOS', 'DESCRIÇÃO', 'QTD', 'PREÇO UNIT.', 'TOTAL',
    'Limpeza de split 12.000 BTU', 'R$ 300,00', 'Validade da proposta: 12/12/2026', 'Responsável pela proposta: Dono da Empresa',
    'Responsável / empresa', 'Cliente / aceite', 'Página 1 de 1']) {
    assert.ok(acharTexto(r, t), `A: "${t}"`);
  }
  // Serviço sem unidade de medida: só o número (nada de "1 serviço").
  const qtd = textos(r).filter((t) => t.text === '1');
  assert.equal(qtd.length, 1, 'quantidade sem rótulo genérico');
  for (const ausente of ['WhatsApp:', 'Subtotal', 'Desconto', 'Acréscimo', 'GARANTIA', 'CONDIÇÕES DE PAGAMENTO', 'OBSERVAÇÕES', 'SOBRE ESTA PROPOSTA', 'PREVISÃO DE EXECUÇÃO']) {
    assert.equal(contemTexto(r, ausente), false, `A: "${ausente}" não aparece vazio`);
  }
  semProblemas(r, 'A');
});

test('B. Desconto + acréscimo: resumo à direita, ajustes acima do TOTAL, mesmo cálculo', async () => {
  const itens = [item(1, { quantity: 2, unit_price: 150 }), item(2, { kind: 'free', unit: 'm', quantity: 2.5, unit_price: 89.9 })];
  const r = await gerar({ orcamento: orcamentoBase({ discount: 50, surcharge: 20 }), itens });
  await pdfValido(r, 'B');
  // 2 × 150 + 2,5 × 89,90 = 524,75; − 50 + 20 = 494,75
  for (const t of ['Subtotal', 'R$ 524,75', 'Desconto', '- R$ 50,00', 'Acréscimo', '+ R$ 20,00', 'R$ 494,75', '2,5 m', 'R$ 224,75']) assert.ok(acharTexto(r, t), `B: "${t}"`);
  const pagina = r.paginas[0];
  const destaque = pagina.retangulos.find((x) => x.height === 36 && Math.round(x.width) === 236);
  assert.ok(destaque, 'destaque do TOTAL');
  assert.ok(destaque.x + destaque.width <= DIREITA + 0.01 && destaque.x >= DIREITA - 236 - 0.01, 'resumo alinhado à direita');
  const linhas = ['Subtotal', 'Desconto', 'Acréscimo'].map((t) => acharTexto(r, t));
  assert.ok(linhas[0].y > linhas[1].y && linhas[1].y > linhas[2].y, 'ordem: subtotal, desconto, acréscimo');
  assert.ok(linhas[2].baixo > destaque.y + destaque.height + 3, 'ajustes inteiros acima do TOTAL');
  const total = acharTexto(r, 'R$ 494,75');
  assert.ok(total.size >= 15 && total.baixo > destaque.y && total.alto < destaque.y + destaque.height, 'TOTAL é o maior valor e fica dentro do destaque');
  assert.ok(textos(r).filter((t) => /^R\$|^[-+] R\$/.test(t.text)).every((t) => t.size <= total.size), 'nenhum valor maior que o TOTAL');
  semProblemas(r, 'B');
});

test('C. 24 itens: várias páginas, linha nunca cortada, cabeçalhos repetidos, total só após o último item', async () => {
  const itens = Array.from({ length: 24 }, (_, i) => item(i + 1, {
    name: `Item ${String(i + 1).padStart(2, '0')} — manutenção preventiva completa com limpeza, testes e relatório fotográfico do equipamento`,
    notes: i % 4 === 0 ? 'Inclui material de consumo e deslocamento dentro da cidade.' : null, quantity: i + 1, unit_price: 10 + i,
  }));
  const r = await gerar({ orcamento: orcamentoBase({ payment_terms: 'Pix na aprovação.', notes: 'Observação final.' }), itens });
  const doc = await pdfValido(r, 'C');
  const n = doc.getPageCount();
  assert.ok(n >= 3, `várias páginas (${n})`);
  const todos = textos(r);
  for (let i = 1; i <= 24; i++) {
    const nome = todos.find((t) => t.text.startsWith(`Item ${String(i).padStart(2, '0')} `));
    const valor = todos.find((t) => t.text === `R$ ${((i) * (9 + i)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    assert.ok(nome && valor, `item ${i} desenhado`);
    const linhasDoItem = todos.filter((t) => t.pagina === nome.pagina && t.x === nome.x && Math.abs(t.y - nome.y) < 40 && t.size === nome.size);
    assert.ok(linhasDoItem.length >= 1);
    assert.equal(valor.pagina, nome.pagina, `item ${i}: descrição e total na mesma página`);
  }
  // Toda página com itens repete o cabeçalho da tabela; as seguintes têm cabeçalho de continuação.
  const paginasComItens = new Set(todos.filter((t) => /^Item \d\d /.test(t.text)).map((t) => t.pagina));
  for (const p of paginasComItens) assert.ok(todos.some((t) => t.pagina === p && t.text === 'DESCRIÇÃO'), `página ${p + 1}: cabeçalho da tabela`);
  for (let p = 1; p < n; p++) assert.ok(todos.some((t) => t.pagina === p && t.text === 'ORÇAMENTO ORC-0042 · CONTINUAÇÃO'), `página ${p + 1}: cabeçalho simplificado`);
  for (let p = 0; p < n; p++) assert.ok(todos.some((t) => t.pagina === p && t.text === `Página ${p + 1} de ${n}`), `página ${p + 1}: rodapé`);
  // Título nunca sozinho: está na mesma página do primeiro item.
  assert.equal(acharTexto(r, 'PRODUTOS E SERVIÇOS').pagina, todos.find((t) => t.text.startsWith('Item 01 ')).pagina);
  // Total depois do último item.
  const ultimo = todos.find((t) => t.text.startsWith('Item 24 '));
  const total = todos.find((t) => t.text === 'TOTAL' && t.size === 10);
  assert.ok(total.pagina > ultimo.pagina || (total.pagina === ultimo.pagina && total.y < ultimo.y), 'TOTAL só depois do último item');
  // Logo nunca nas páginas seguintes.
  assert.ok(r.paginas.slice(1).every((p) => p.imagens.length === 0));
  semProblemas(r, 'C');
});

test('D/E/F. Logo PNG correta, JPG problemática e sem logo: o resto do documento é igual', async () => {
  // O cabeçalho muda de largura com a logo (o contato pode quebrar em 2 linhas); o resto é idêntico.
  const conteudo = (r) => textos(r).filter((t) => !(t.pagina === 0 && t.y > TOPO - 80)).map((t) => t.text).join('|');
  const d = await gerar(comLogo(png(300, 100, { alfa: true }), 'image/png'));
  const e = await gerar(comLogo(jpeg(700, 1000, 980 * 1024), 'image/jpeg'));
  const f = await gerar();
  for (const [nome, r] of [['D', d], ['E', e], ['F', f]]) { await pdfValido(r, nome); semProblemas(r, nome); }
  assert.equal(conteudo(d), conteudo(f), 'logo PNG não muda o conteúdo');
  assert.equal(conteudo(e), conteudo(f), 'logo JPG problemática não muda o conteúdo');
  for (const [nome, r] of [['D', d], ['E', e], ['F', f]]) {
    const cabecalho = r.paginas[0].textos.filter((t) => t.y > TOPO - 80).map((t) => t.text);
    for (const parte of ['12.345.678/0001-90', '11 4000-0000', '11 90000-0000', 'contato@exemplo.invalid']) assert.ok(cabecalho.some((t) => t.includes(parte)), `${nome}: contato "${parte}"`);
    assert.ok(cabecalho.every((t) => !/·\s*$/.test(t) && !/^\s*·/.test(t)), `${nome}: contato nunca quebra deixando "·" pendurado`);
  }
  // A tabela começa no mesmo lugar com ou sem logo: o cabeçalho tem altura controlada.
  const yTabela = (r) => acharTexto(r, 'PRODUTOS E SERVIÇOS').y;
  assert.ok(Math.abs(yTabela(d) - yTabela(f)) <= 12 && Math.abs(yTabela(e) - yTabela(f)) <= 12, 'cabeçalho compacto nos três casos');
});

test('G. Textos longos: nome de empresa, cliente, endereço, proposta, condições e observações sem invadir nada', async () => {
  const longo = (base, n) => Array.from({ length: n }, (_, i) => `${base} ${i + 1}`).join(' ');
  const r = await gerar({
    empresa: { ...empresaBase(), name: 'Js Connect Climatização, Refrigeração Comercial, Automação Predial, Segurança Eletrônica e Instalações Elétricas Industriais do Brasil Ltda.', logo_path: `${COMPANY}/logo` },
    objetos: { [`zt-branding/${COMPANY}/logo`]: ['image/png', png(100, 400)] },
    cliente: { ...clienteBase(), name: 'Condomínio Residencial Parque das Árvores Floridas do Jardim Botânico Bloco Norte e Sul', whatsapp: '11 98888-7777' },
    orcamento: orcamentoBase({
      service_place: 'Casa de máquinas, subsolo 2, acesso pela rampa lateral',
      address: 'Avenida Brigadeiro Faria Lima, 3.477 · Torre B · 14º andar · Itaim Bibi · São Paulo/SP · CEP 04538-133',
      customer_message: longo('Proposta detalhada para manutenção preventiva e corretiva dos equipamentos de climatização.', 90),
      payment_terms: longo('Entrada na aprovação e saldo na conclusão.', 6),
      notes: longo('Observação importante sobre acesso, horários e responsabilidades.', 8),
      execution_forecast_date: '2026-12-01', discount: 10, surcharge: 5,
    }),
    itens: [item(1, { name: longo('Instalação completa de split inverter com tubulação de cobre isolada', 6), notes: longo('Nota técnica', 15), unit: 'serviço', unit_price: 1890.5 })],
  });
  await pdfValido(r, 'G');
  for (const t of ['SOBRE ESTA PROPOSTA', 'SOBRE ESTA PROPOSTA · CONTINUAÇÃO', 'PREVISÃO DE EXECUÇÃO', 'CONDIÇÕES DE PAGAMENTO', 'OBSERVAÇÕES', 'WhatsApp: 11 98888-7777']) {
    assert.ok(contemTexto(r, t), `G: "${t}"`);
  }
  // Cabeçalho: nome da empresa (2 linhas, reticências) não encosta no bloco ORÇAMENTO.
  const cab = r.paginas[0].textos.filter((t) => t.y > TOPO - 70);
  const direita = cab.filter((t) => ['ORÇAMENTO', 'Nº ORC-0042'].includes(t.text) || t.text.startsWith('Emissão') || t.text.startsWith('Validade'));
  const esquerda = cab.filter((t) => !direita.includes(t));
  assert.ok(esquerda.length >= 2 && direita.length >= 3);
  assert.ok(Math.max(...esquerda.map((t) => t.x2)) < Math.min(...direita.map((t) => t.x)) - 10, 'colunas do cabeçalho separadas');
  const linhasNome = esquerda.filter((t) => t.size === 13);
  assert.equal(linhasNome.length, 2, 'nome da empresa em no máximo 2 linhas');
  assert.ok(linhasNome[1].text.endsWith('...'), 'nome muito longo termina com reticências');
  semProblemas(r, 'G');
});

// ─────────────────────────── 3. garantia, quantidade, miniaturas

test('Garantia em bloco próprio: item e prazo em linhas separadas, singular e plural corretos', async () => {
  const P1 = 'a4444444-4444-4444-8444-444444444441', P2 = 'a4444444-4444-4444-8444-444444444442', S1 = 'a6666666-6666-4666-8666-666666666661';
  const r = await gerar({
    itens: [
      item(1, { kind: 'service', service_id: S1, name: 'Instalação da fechadura', unit: 'serviço' }),
      item(2, { kind: 'product', product_id: P1, name: 'Intelbras FR101', unit: 'un' }),
      item(3, { kind: 'product', product_id: P2, name: 'Pilhas alcalinas', unit: 'un' }),
    ],
    produtos: { [P1]: { id: P1, image_path: null, warranty_months: 12 }, [P2]: { id: P2, image_path: null, warranty_months: 1 } },
    servicos: { [S1]: { id: S1, warranty_days: 90 } },
  });
  await pdfValido(r, 'garantia');
  for (const [titulo, detalhe] of [['Instalação da fechadura', '90 dias de garantia de serviço'], ['Intelbras FR101', '12 meses de garantia do produto'], ['Pilhas alcalinas', '1 mês de garantia do produto']]) {
    const linhaTitulo = textos(r).filter((t) => t.text === titulo).at(-1);
    const linhaDetalhe = acharTexto(r, detalhe);
    assert.ok(linhaTitulo && linhaDetalhe, `${titulo} / ${detalhe}`);
    assert.ok(linhaDetalhe.y < linhaTitulo.y && linhaTitulo.y - linhaDetalhe.y <= 14, `${titulo}: prazo logo abaixo do item`);
  }
  assert.ok(acharTexto(r, 'GARANTIA'));
  semProblemas(r, 'garantia');
});

test('Miniaturas de produto contidas em 34 × 34; falha de imagem não derruba o PDF', async () => {
  const P1 = 'a4444444-4444-4444-8444-444444444441', P2 = 'a4444444-4444-4444-8444-444444444442', P3 = 'a4444444-4444-4444-8444-444444444443';
  const r = await gerar({
    orcamento: orcamentoBase({ show_product_images: true }),
    itens: [item(1, { kind: 'product', product_id: P1, name: 'Ar-condicionado' }), item(2, { kind: 'product', product_id: P2, name: 'Controle remoto' }), item(3, { kind: 'product', product_id: P3, name: 'Suporte' })],
    produtos: { [P1]: { id: P1, image_path: `${COMPANY}/p1`, warranty_months: 0 }, [P2]: { id: P2, image_path: `${COMPANY}/p2`, warranty_months: 0 }, [P3]: { id: P3, image_path: `${COMPANY}/p3`, warranty_months: 0 } },
    objetos: { [`zt-product-images/${COMPANY}/p1`]: ['image/jpeg', jpeg(4000, 3000, 100 * 1024)], [`zt-product-images/${COMPANY}/p2`]: ['image/png', png(30, 300)], [`zt-product-images/${COMPANY}/p3`]: ['image/png', Buffer.from('quebrada')] },
  });
  await pdfValido(r, 'miniaturas');
  const imagens = r.paginas[0].imagens;
  assert.equal(imagens.length, 2, 'duas miniaturas válidas; a quebrada fica de fora');
  for (const im of imagens) {
    assert.ok(im.width <= 34.01 && im.height <= 34.01, 'miniatura contida');
    assert.ok(Math.abs(im.width / im.height - im.naturalW / im.naturalH) / (im.naturalW / im.naturalH) < 0.01, 'proporção preservada');
  }
  assert.ok(acharTexto(r, 'Suporte'), 'item sem imagem continua no PDF');
  semProblemas(r, 'miniaturas');
});

test('Contrato: sem marca-d\'água e o mesmo desenho nos dois geradores', () => {
  const vercel = read('api/quote-pdf.js');
  const edge = read('supabase/functions/quote-pdf/handler.js');
  for (const fonte of [vercel, edge]) {
    assert.doesNotMatch(fonte, /drawPageWatermark|opacity|watermark/i);
    assert.match(fonte, /const LOGO_CAIXA = \{ width: 112, height: 52 \};/);
  }
});
