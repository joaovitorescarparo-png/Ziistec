import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/* Recibo / documento de cobrança para o cliente.
 *
 * NÃO é documento fiscal e o PDF diz isso de forma explícita. Não emite NF-e,
 * NFS-e nem DANFE, e não chama nenhum serviço externo.
 *
 * É gerado no próprio navegador a partir de dados que o proprietário já tem
 * carregados (protegidos por RLS). Não cria endpoint, bucket nem tabela nova.
 */

const limpar = (v = '') => String(v ?? '')
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2022]/g, '-').replace(/[\u2013\u2014]/g, '-')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');

const dinheiro = (n) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBR = (s) => (s ? String(s).split('-').reverse().join('/') : '-');
const nomeArquivoSeguro = (s) => limpar(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'recibo';

function quebrar(texto, fonte, tamanho, largura) {
  const linhas = [];
  for (const paragrafo of limpar(texto).split(/\r?\n/)) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);
    if (!palavras.length) { linhas.push(''); continue; }
    let linha = '';
    for (const palavra of palavras) {
      const teste = linha ? `${linha} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(teste, tamanho) <= largura) linha = teste;
      else { if (linha) linhas.push(linha); linha = palavra; }
    }
    if (linha) linhas.push(linha);
  }
  return linhas;
}

export async function montarReciboPDF(dados) {
  const {
    empresa = {}, cliente = {}, numero = '', titulo = 'RECIBO', origem = '', itens = [],
    valor = 0, vencimento = null, pagoEm = null, forma = null,
    observacoes = '', emitidoEm = new Date().toISOString().slice(0, 10),
    logoBytes = null, logoTipo = '',
  } = dados || {};

  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([595.28, 841.89]);          // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = pagina.getSize();
  const margem = 48;
  const tinta = rgb(0.08, 0.11, 0.15);
  const suave = rgb(0.45, 0.5, 0.56);
  const linhaCor = rgb(0.85, 0.88, 0.91);
  let y = height - margem;

  const escrever = (texto, { x = margem, size = 10, fonte = regular, cor = tinta } = {}) => {
    pagina.drawText(limpar(texto), { x, y, size, font: fonte, color: cor });
  };
  const direita = (texto, { size = 10, fonte = regular, cor = tinta } = {}) => {
    const t = limpar(texto);
    pagina.drawText(t, { x: width - margem - fonte.widthOfTextAtSize(t, size), y, size, font: fonte, color: cor });
  };
  const regua = () => {
    pagina.drawLine({ start: { x: margem, y }, end: { x: width - margem, y }, thickness: 0.7, color: linhaCor });
  };

  /* cabeçalho: logo quando houver, dados da empresa e identificação do documento */
  if (logoBytes) {
    try {
      const tipo = String(logoTipo || '').toLowerCase();
      const img = tipo.includes('png') ? await pdf.embedPng(logoBytes)
        : (tipo.includes('jpeg') || tipo.includes('jpg')) ? await pdf.embedJpg(logoBytes) : null;
      if (img) {
        const alvo = 46;
        const escala = Math.min(alvo / img.height, 120 / img.width);
        pagina.drawImage(img, { x: margem, y: y - alvo, width: img.width * escala, height: img.height * escala });
      }
    } catch { /* logo inválida não impede o documento */ }
  }

  y -= 8;
  escrever(empresa.nome || 'Empresa', { x: margem + (logoBytes ? 132 : 0), size: 15, fonte: negrito });
  direita(titulo, { size: titulo.length > 18 ? 11 : 15, fonte: negrito });
  y -= 15;
  if (empresa.documento) escrever(`CNPJ/CPF: ${empresa.documento}`, { x: margem + (logoBytes ? 132 : 0), size: 9, cor: suave });
  direita(numero ? `Nº ${numero}` : '', { size: 9, cor: suave });
  y -= 12;
  const contato = [empresa.telefone, empresa.email].filter(Boolean).join(' · ');
  if (contato) escrever(contato, { x: margem + (logoBytes ? 132 : 0), size: 9, cor: suave });
  direita(`Emitido em ${dataBR(emitidoEm)}`, { size: 9, cor: suave });
  y -= 12;
  if (empresa.endereco) {
    for (const linha of quebrar(empresa.endereco, regular, 9, 300)) { escrever(linha, { x: margem + (logoBytes ? 132 : 0), size: 9, cor: suave }); y -= 11; }
  }

  y -= 10; regua(); y -= 20;

  /* aviso obrigatório: este documento não substitui nota fiscal */
  pagina.drawRectangle({ x: margem, y: y - 22, width: width - margem * 2, height: 30, color: rgb(0.98, 0.95, 0.86) });
  escrever('DOCUMENTO NAO FISCAL', { x: margem + 12, size: 11, fonte: negrito, cor: rgb(0.48, 0.35, 0.05) });
  y -= 13;
  escrever('Comprovante de servico/cobranca. Nao substitui nota fiscal.', { x: margem + 12, size: 8.5, cor: rgb(0.48, 0.35, 0.05) });
  y -= 30;

  /* cliente */
  escrever('CLIENTE', { size: 8.5, fonte: negrito, cor: suave }); y -= 14;
  escrever(cliente.nome || '-', { size: 11.5, fonte: negrito }); y -= 13;
  if (cliente.documento) { escrever(`CNPJ/CPF: ${cliente.documento}`, { size: 9, cor: suave }); y -= 12; }
  if (cliente.telefone) { escrever(cliente.telefone, { size: 9, cor: suave }); y -= 12; }
  if (cliente.endereco) {
    for (const linha of quebrar(cliente.endereco, regular, 9, width - margem * 2)) { escrever(linha, { size: 9, cor: suave }); y -= 11; }
  }
  if (origem) { y -= 2; escrever(`Referente a: ${origem}`, { size: 9, cor: suave }); y -= 12; }

  y -= 8; regua(); y -= 20;

  /* itens/resumo do serviço */
  escrever('DESCRICAO', { size: 8.5, fonte: negrito, cor: suave });
  direita('VALOR', { size: 8.5, fonte: negrito, cor: suave });
  y -= 6; regua(); y -= 16;

  const lista = (itens || []).slice(0, 40);
  if (!lista.length) { escrever('Servicos prestados', { size: 10 }); y -= 16; }
  for (const item of lista) {
    const descricao = [item.nome, item.qtd ? `(${item.qtd} ${item.unidade || 'un'})` : ''].filter(Boolean).join(' ');
    const linhas = quebrar(descricao, regular, 10, width - margem * 2 - 110);
    linhas.forEach((linha, idx) => {
      escrever(linha, { size: 10 });
      if (idx === 0 && item.total != null) direita(dinheiro(item.total), { size: 10 });
      y -= 14;
    });
    if (y < 170) break;                    // mantém o rodapé legível em uma página
  }

  y -= 4; regua(); y -= 24;
  escrever('TOTAL', { size: 11, fonte: negrito });
  direita(dinheiro(valor), { size: 18, fonte: negrito });
  y -= 26;

  /* pagamento */
  const pagamento = [];
  if (pagoEm) pagamento.push(`Pago em ${dataBR(pagoEm)}`);
  else if (vencimento) pagamento.push(`Vencimento ${dataBR(vencimento)}`);
  if (forma) pagamento.push(`Forma: ${forma}`);
  if (pagamento.length) { escrever(pagamento.join('   ·   '), { size: 9.5, cor: suave }); y -= 18; }

  if (observacoes) {
    y -= 4;
    escrever('OBSERVACOES', { size: 8.5, fonte: negrito, cor: suave }); y -= 13;
    for (const linha of quebrar(observacoes, regular, 9.5, width - margem * 2)) {
      if (y < 90) break;
      escrever(linha, { size: 9.5, cor: suave }); y -= 12;
    }
  }

  /* rodapé */
  pagina.drawText(limpar('Documento nao fiscal emitido pelo ZiisTec.'), {
    x: margem, y: 46, size: 8, font: regular, color: suave,
  });

  return pdf.save();
}

export async function baixarReciboPDF(dados, nomeArquivo) {
  const bytes = await montarReciboPDF(dados);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeArquivoSeguro(nomeArquivo || `Recibo-${dados?.numero || ''}`) + (String(nomeArquivo || '').endsWith('.pdf') ? '' : '.pdf');
  a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

export function suportaCompartilharRecibo() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function' && typeof File !== 'undefined';
}

export async function compartilharReciboPDF(dados, nomeArquivo, texto = '') {
  if (!suportaCompartilharRecibo()) return { shared: false, unsupported: true };
  const bytes = await montarReciboPDF(dados);
  const arquivo = new File([bytes], nomeArquivoSeguro(nomeArquivo) + '.pdf', { type: 'application/pdf' });
  if (!navigator.canShare({ files: [arquivo] })) return { shared: false, unsupported: true };
  try {
    await navigator.share({ title: 'Recibo', text: texto, files: [arquivo] });
    return { shared: true };
  } catch (e) {
    if (e?.name === 'AbortError') return { shared: false, cancelled: true };
    throw e;
  }
}
