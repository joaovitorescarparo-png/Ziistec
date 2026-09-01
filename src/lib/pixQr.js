const encoder = new TextEncoder();

const ascii = (value, max) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 $%*+\-./:]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max);

const tlv = (id, value) => {
  const v = String(value ?? '');
  const len = encoder.encode(v).length;
  if (len > 99) throw new Error(`Campo Pix ${id} excede 99 bytes.`);
  return `${id}${String(len).padStart(2, '0')}${v}`;
};

export function crc16Pix(value) {
  let crc = 0xffff;
  for (const byte of encoder.encode(value)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000)
        ? ((crc << 1) ^ 0x1021) & 0xffff
        : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildPixPayload({ key, receiverName, receiverCity, amount, txid = '***' }) {
  const pixKey = String(key || '').trim();
  const name = ascii(receiverName, 25);
  const city = ascii(receiverCity, 15);
  if (!pixKey) throw new Error('Configure a chave Pix da empresa.');
  if (!name) throw new Error('Configure o nome do recebedor do Pix.');
  if (!city) throw new Error('Configure a cidade do recebedor do Pix.');
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) throw new Error('O valor do Pix precisa ser maior que zero.');

  const merchant = tlv('00', 'br.gov.bcb.pix') + tlv('01', pixKey);
  const additional = tlv('05', ascii(txid || '***', 25) || '***');
  const body = tlv('00', '01')
    + tlv('26', merchant)
    + tlv('52', '0000')
    + tlv('53', '986')
    + tlv('54', value.toFixed(2))
    + tlv('58', 'BR')
    + tlv('59', name)
    + tlv('60', city)
    + tlv('62', additional)
    + '6304';
  return body + crc16Pix(body);
}

// QR Code Model 2, version 8-L, byte mode. Version 8-L supports up to 192 bytes,
// suficiente para o payload Pix estático usado nesta etapa da ZiisTec.
// Blocos RS da versão 8-L: 2 blocos de 97 data codewords + 24 EC codewords.
const QR_VERSION = 8;
const QR_SIZE = 49;
const DATA_CODEWORDS = 194;
const EC_CODEWORDS_PER_BLOCK = 24;

const gfExp = new Uint16Array(512);
const gfLog = new Uint16Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) gfExp[i] = gfExp[i - 255];
}

const gfMul = (a, b) => (a && b ? gfExp[gfLog[a] + gfLog[b]] : 0);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], gfExp[i]);
    }
    poly = next;
  }
  return poly;
}
const RS_GEN = rsGenerator(EC_CODEWORDS_PER_BLOCK);

function rsRemainder(data) {
  const result = new Array(EC_CODEWORDS_PER_BLOCK).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let j = 0; j < EC_CODEWORDS_PER_BLOCK; j += 1) {
      result[j] ^= gfMul(RS_GEN[j + 1], factor);
    }
  }
  return result;
}

function appendBits(out, value, count) {
  for (let i = count - 1; i >= 0; i -= 1) out.push((value >>> i) & 1);
}

function dataCodewords(text) {
  const bytes = [...encoder.encode(text)];
  if (bytes.length > 192) throw new Error('Payload Pix grande demais para o QR local.');
  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  const capacity = DATA_CODEWORDS * 8;
  for (let i = 0; i < Math.min(4, capacity - bits.length); i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  let pad = 0;
  while (data.length < DATA_CODEWORDS) data.push(pad++ % 2 === 0 ? 0xec : 0x11);
  return data;
}

function finalCodewords(text) {
  const data = dataCodewords(text);
  const blocks = [data.slice(0, 97), data.slice(97, 194)];
  const ecc = blocks.map(rsRemainder);
  const all = [];
  for (let i = 0; i < 97; i += 1) all.push(blocks[0][i], blocks[1][i]);
  for (let i = 0; i < EC_CODEWORDS_PER_BLOCK; i += 1) all.push(ecc[0][i], ecc[1][i]);
  return all;
}

function bch(value, poly) {
  let data = value;
  const degree = (x) => 31 - Math.clz32(x);
  const polyDegree = degree(poly);
  while (data && degree(data) >= polyDegree) data ^= poly << (degree(data) - polyDegree);
  return data;
}

function formatBits(mask = 0) {
  const data = (1 << 3) | mask; // nível L = 01
  return (((data << 10) | bch(data << 10, 0x537)) ^ 0x5412) & 0x7fff;
}
function versionBits() {
  return (QR_VERSION << 12) | bch(QR_VERSION << 12, 0x1f25);
}

function setFinder(matrix, row, col) {
  for (let dr = -1; dr <= 7; dr += 1) {
    for (let dc = -1; dc <= 7; dc += 1) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= QR_SIZE || c >= QR_SIZE) continue;
      matrix[r][c] = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
        && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
    }
  }
}

function setAlignment(matrix, row, col) {
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      matrix[row + dr][col + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
    }
  }
}

function drawFunctionPatterns(matrix, mask = 0) {
  setFinder(matrix, 0, 0);
  setFinder(matrix, 0, QR_SIZE - 7);
  setFinder(matrix, QR_SIZE - 7, 0);

  for (const row of [6, 24, 42]) {
    for (const col of [6, 24, 42]) {
      if (matrix[row][col] === null) setAlignment(matrix, row, col);
    }
  }
  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }

  const format = formatBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const bit = ((format >>> i) & 1) === 1;
    if (i < 6) matrix[i][8] = bit;
    else if (i < 8) matrix[i + 1][8] = bit;
    else matrix[QR_SIZE - 15 + i][8] = bit;

    if (i < 8) matrix[8][QR_SIZE - i - 1] = bit;
    else if (i < 9) matrix[8][15 - i] = bit;
    else matrix[8][15 - i - 1] = bit;
  }
  matrix[QR_SIZE - 8][8] = true;

  const version = versionBits();
  for (let i = 0; i < 18; i += 1) {
    const bit = ((version >>> i) & 1) === 1;
    matrix[Math.floor(i / 3)][i % 3 + QR_SIZE - 11] = bit;
    matrix[i % 3 + QR_SIZE - 11][Math.floor(i / 3)] = bit;
  }
}

export function qrMatrixForText(text) {
  const matrix = Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(null));
  drawFunctionPatterns(matrix, 0);
  const codewords = finalCodewords(text);
  let bitIndex = 0;
  let upward = true;

  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < QR_SIZE; vert += 1) {
      const row = upward ? QR_SIZE - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const col = right - j;
        if (matrix[row][col] !== null) continue;
        const byte = codewords[bitIndex >>> 3] ?? 0;
        const bit = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex += 1;
        matrix[row][col] = bit ^ (((row + col) & 1) === 0); // máscara 0
      }
    }
    upward = !upward;
  }
  return matrix.map((row) => row.map(Boolean));
}

export function pixQrSvgDataUri(payload, { scale = 5, margin = 4 } = {}) {
  const matrix = qrMatrixForText(payload);
  const size = matrix.length + margin * 2;
  let path = '';
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix.length; col += 1) {
      if (matrix[row][col]) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * scale}" height="${size * scale}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="black"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
