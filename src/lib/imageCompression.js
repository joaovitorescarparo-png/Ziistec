/* Compressão de FOTO antes do upload.
 *
 * Foto de celular chega com 3–10 MB (4000 × 3000 px ou mais). Para registro técnico da OS,
 * 1920 px no lado maior mantém legível placa de identificação, etiqueta e número de série,
 * e o arquivo cai para algumas centenas de KB.
 *
 * Regras:
 * - só imagem (JPEG, PNG, WEBP, HEIC/HEIF); vídeo e PDF passam intactos;
 * - foto pequena (lado ≤ máximo e até ~600 KB) segue original;
 * - saída JPEG (os PDFs da OS usam JPEG/PNG; WEBP não entra no pdf-lib);
 * - PNG com transparência vira JPEG sobre fundo branco (sem fundo preto);
 * - a orientação da câmera é aplicada nos pixels. O EXIF não é mantido — nenhuma parte do
 *   produto lê EXIF, e isso também tira a localização GPS embutida na foto;
 * - se o navegador não decodifica (ex.: HEIC fora do Safari) ou o resultado não fica menor,
 *   o arquivo original segue, sujeito aos limites de sempre;
 * - o mesmo `File` sempre gera o mesmo arquivo comprimido (cache), então o reenvio após
 *   falha de rede mantém o mesmo SHA-256 e a deduplicação por conteúdo continua valendo.
 */
export const FOTO_LADO_MAXIMO = 1920;
export const FOTO_QUALIDADE = 0.8;
export const FOTO_LIMITE_SEM_COMPRESSAO = 600 * 1024;
export const DOCUMENTO_IMAGEM_OPCOES = Object.freeze({ ladoMaximo: 2400, qualidade: 0.85 });

const COMPRIMIVEIS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const cache = new WeakMap();

export function tipoDaImagem(file) {
  const tipo = String(file?.type || '').toLowerCase();
  if (tipo) return tipo === 'image/jpg' ? 'image/jpeg' : tipo;
  const ext = String(file?.name || '').split('.').pop()?.toLowerCase() || '';
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' }[ext] || '';
}

export const imagemComprimivel = (file) => COMPRIMIVEIS.has(tipoDaImagem(file));

/* Decide, sem tocar em pixel, se e para que tamanho comprimir. Pura: testável. */
export function planoCompressao({ largura, altura, bytes, tipo }, {
  ladoMaximo = FOTO_LADO_MAXIMO, limiteBytes = FOTO_LIMITE_SEM_COMPRESSAO,
} = {}) {
  const w = Number(largura) || 0;
  const h = Number(altura) || 0;
  if (!COMPRIMIVEIS.has(tipo) || w <= 0 || h <= 0) return { comprimir: false, largura: w, altura: h, escala: 1 };
  const escala = Math.min(1, ladoMaximo / Math.max(w, h));
  const heic = tipo === 'image/heic' || tipo === 'image/heif';
  if (escala === 1 && Number(bytes || 0) <= limiteBytes && !heic) return { comprimir: false, largura: w, altura: h, escala };
  return { comprimir: true, largura: Math.max(1, Math.round(w * escala)), altura: Math.max(1, Math.round(h * escala)), escala };
}

export function nomeJpeg(nome) {
  const base = String(nome || 'foto').replace(/\.[^./\\]+$/, '') || 'foto';
  return `${base}.jpg`;
}

async function decodificar(file) {
  if (typeof createImageBitmap !== 'function') return null;
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { return null; }
}

function novoCanvas(largura, altura) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(largura, altura);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = largura; c.height = altura;
    return c;
  }
  return null;
}

async function paraJpeg(canvas, qualidade) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/jpeg', quality: qualidade });
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || null), 'image/jpeg', qualidade));
}

async function comprimir(file, { ladoMaximo, limiteBytes, qualidade }) {
  const tipo = tipoDaImagem(file);
  const bitmap = await decodificar(file);
  if (!bitmap) return file;
  try {
    const plano = planoCompressao({ largura: bitmap.width, altura: bitmap.height, bytes: file.size, tipo }, { ladoMaximo, limiteBytes });
    if (!plano.comprimir) return file;
    const canvas = novoCanvas(plano.largura, plano.altura);
    const ctx = canvas?.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, plano.largura, plano.altura);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, plano.largura, plano.altura);
    const blob = await paraJpeg(canvas, qualidade);
    if (!blob || !blob.size) return file;
    // Redimensionar sempre vale; só recomprimir sem reduzir tamanho, não.
    if (plano.escala === 1 && blob.size >= file.size) return file;
    return new File([blob], nomeJpeg(file.name), { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
  } finally {
    bitmap.close?.();
  }
}

export function comprimirImagemParaUpload(file, {
  ladoMaximo = FOTO_LADO_MAXIMO, limiteBytes = FOTO_LIMITE_SEM_COMPRESSAO, qualidade = FOTO_QUALIDADE,
} = {}) {
  if (!file || typeof file !== 'object' || !imagemComprimivel(file)) return Promise.resolve(file);
  const chave = `${ladoMaximo}:${limiteBytes}:${qualidade}`;
  let porOpcao = cache.get(file);
  if (!porOpcao) { porOpcao = new Map(); cache.set(file, porOpcao); }
  if (!porOpcao.has(chave)) {
    porOpcao.set(chave, comprimir(file, { ladoMaximo, limiteBytes, qualidade }).catch(() => file));
  }
  return porOpcao.get(chave);
}
