const MAX_SIDE = 1400;
const WHITE_MIN = 240;
const ALPHA_MIN = 12;

const canvasBlob = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a logo.')), 'image/png');
});

async function carregarImagem(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a logo.')); };
    img.src = url;
  });
}

const quaseBranco = (data, i) => {
  const a = data[i + 3];
  if (a < ALPHA_MIN) return true;
  const r = data[i], g = data[i + 1], b = data[i + 2];
  return r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN && Math.max(r, g, b) - Math.min(r, g, b) <= 18;
};

function removerFundoBrancoConectado(imageData) {
  const { data, width, height } = imageData;
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const whiteCorners = corners.filter((p) => quaseBranco(data, p * 4)).length;
  if (whiteCorners < 3) return imageData;

  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const push = (p) => {
    if (p < 0 || p >= width * height || seen[p] || !quaseBranco(data, p * 4)) return;
    seen[p] = 1;
    queue[tail++] = p;
  };

  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { push(y * width); push(y * width + width - 1); }

  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p / width) | 0;
    const i = p * 4;
    data[i + 3] = 0;
    if (x > 0) push(p - 1);
    if (x + 1 < width) push(p + 1);
    if (y > 0) push(p - width);
    if (y + 1 < height) push(p + width);
  }
  return imageData;
}

function caixaConteudo(imageData) {
  const { data, width, height } = imageData;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a <= ALPHA_MIN) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const pad = Math.max(4, Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * 0.025));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export async function prepararLogoTransparente(file) {
  if (!(file instanceof File)) throw new Error('Selecione uma imagem.');
  if (typeof document === 'undefined') return file;

  const source = await carregarImagem(file);
  const sourceW = source.width || source.naturalWidth;
  const sourceH = source.height || source.naturalHeight;
  if (!sourceW || !sourceH) throw new Error('A logo não possui dimensões válidas.');

  const scale = Math.min(1, MAX_SIDE / Math.max(sourceW, sourceH));
  const width = Math.max(1, Math.round(sourceW * scale));
  const height = Math.max(1, Math.round(sourceH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Não foi possível preparar a logo.');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  if (typeof source.close === 'function') source.close();

  const pixels = ctx.getImageData(0, 0, width, height);
  removerFundoBrancoConectado(pixels);
  ctx.putImageData(pixels, 0, 0);
  const box = caixaConteudo(pixels);
  if (!box) throw new Error('Não foi possível identificar o desenho da logo.');

  const out = document.createElement('canvas');
  out.width = box.width;
  out.height = box.height;
  const outCtx = out.getContext('2d');
  if (!outCtx) throw new Error('Não foi possível finalizar a logo.');
  outCtx.clearRect(0, 0, out.width, out.height);
  outCtx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  const blob = await canvasBlob(out);
  return new File([blob], 'logo-limpa.png', { type: 'image/png', lastModified: Date.now() });
}
