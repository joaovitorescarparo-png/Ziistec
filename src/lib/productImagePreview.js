const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Legacy objects omit the product UUID directory.
// Filenames are not MIME evidence: old uploads preserved .jfif/extensionless names.
const PRODUCT_PATH = new RegExp(`^${UUID}/products/(?:${UUID}/)?[a-z0-9_-][a-z0-9_.-]*$`, 'i');

export function isProductImagePath(path) {
  return typeof path === 'string' && path.length <= 1024 && PRODUCT_PATH.test(path);
}

// The trusted origin comes from the configured Supabase client, never a DB row.
export function safeProductImageUrl(value, supabaseUrl, path) {
  if (!isProductImagePath(path) || typeof value !== 'string') return null;
  try {
    const trusted = new URL(supabaseUrl);
    const url = new URL(value);
    if (trusted.protocol !== 'https:' || url.protocol !== 'https:' || url.origin !== trusted.origin || url.username || url.password || url.hash) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (!['zt-product-images', 'zt-branding'].some(bucket => pathname === `/storage/v1/object/sign/${bucket}/${path}`)) return null;
    if (!url.searchParams.get('token')) return null;
    return url.href;
  } catch { return null; }
}

// Decode instead of trusting File.type alone; only fresh PNG pixels reach <img>.
// This affects preview only, never the original file used for upload.
export async function createProductImagePreview(file) {
  if (!(file instanceof Blob) || !IMAGE_TYPES.has(file.type) || file.size === 0 || file.size > 2 * 1024 * 1024) {
    throw new Error('Use uma foto JPG, PNG ou WEBP de até 2 MB.');
  }
  if (typeof createImageBitmap !== 'function') throw new Error('Não foi possível preparar a prévia neste navegador.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Imagem inválida.');
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a prévia.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob?.type === 'image/png' ? resolve(blob) : reject(new Error('Não foi possível preparar a prévia.')), 'image/png'));
    return URL.createObjectURL(png);
  } finally { bitmap.close(); }
}

export async function createSignedProductImagePreview(url, supabaseUrl, path) {
  const safeUrl = safeProductImageUrl(url, supabaseUrl, path);
  if (!safeUrl) throw new Error('Origem da imagem inválida.');
  const response = await fetch(safeUrl, { credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('Não foi possível carregar a imagem.');
  return createProductImagePreview(await response.blob());
}
