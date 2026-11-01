/* Área padrão da logo nos PDFs da empresa (orçamento, recibo, relatório de serviço e comprovante).
 *
 * 48 mm × 18 mm ≈ 136 × 51 pt. A imagem é encaixada na caixa (contain): a proporção é preservada, nunca
 * é cortada nem esticada, e fica centralizada. O texto do cabeçalho começa depois da caixa inteira, então a
 * posição não muda conforme a logo seja horizontal, vertical ou quadrada. Sem dependências: o servidor
 * (api/quote-pdf.js) e o navegador usam o mesmo módulo. */

export const LOGO_BOX = Object.freeze({
  width: 136,
  height: 51,
  gap: 14,
  /** x onde começa o texto do cabeçalho, em relação à margem esquerda */
  textoX: 136 + 14,
});

/** Maior retângulo com a proporção da imagem que cabe na caixa, centralizado nela. */
export function encaixarNaCaixa(largura, altura, caixa = LOGO_BOX) {
  const w = Number(largura);
  const h = Number(altura);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const escala = Math.min(caixa.width / w, caixa.height / h);
  const width = w * escala;
  const height = h * escala;
  return { width, height, offsetX: (caixa.width - width) / 2, offsetY: (caixa.height - height) / 2 };
}

/** Desenha a logo (PDFImage do pdf-lib) na caixa cujo canto inferior esquerdo é (x, yBase). */
export function desenharLogoNaCaixa(page, image, { x, yBase, opacity = 1 }) {
  const encaixe = encaixarNaCaixa(image?.width, image?.height);
  if (!encaixe) return false;
  page.drawImage(image, { x: x + encaixe.offsetX, y: yBase + encaixe.offsetY, width: encaixe.width, height: encaixe.height, opacity });
  return true;
}

/** Reduz a fonte até `tamanhoMin` e, se ainda não couber, corta com reticências. O texto já deve estar saneado. */
export function ajustarTextoNaLargura(fonte, texto, tamanho, larguraMax, tamanhoMin = 9) {
  const limpo = String(texto ?? '');
  const limite = Math.max(0, Number(larguraMax) || 0);
  let size = tamanho;
  while (size > tamanhoMin && fonte.widthOfTextAtSize(limpo, size) > limite) size -= 0.5;
  if (fonte.widthOfTextAtSize(limpo, size) <= limite) return { texto: limpo, tamanho: size };
  let corte = limpo;
  while (corte.length > 1 && fonte.widthOfTextAtSize(`${corte}...`, size) > limite) corte = corte.slice(0, -1);
  return { texto: `${corte.trimEnd()}...`, tamanho: size };
}
