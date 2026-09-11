import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPixPayload,
  crc16Pix,
  pixQrSvgDataUri,
  qrMatrixForText,
} from '../../src/lib/pixQr.js';

const expectedPayload = '00020126370014br.gov.bcb.pix0115pix@example.com520400005303986540580.005802BR5917ZIIS TEC SERVICOS6007ITAPEMA62070503***6304AB51';

test('F09 Pix: CRC16 usa o vetor conhecido CCITT-FALSE', () => {
  assert.equal(crc16Pix('123456789'), '29B1');
});

test('F09 Pix: payload dinâmico preserva chave, valor exato e normaliza recebedor/cidade', () => {
  const payload = buildPixPayload({
    key:'pix@example.com',
    receiverName:'Ziis Tec Serviços',
    receiverCity:'Itapema',
    amount:80,
  });
  assert.equal(payload, expectedPayload);
  assert.match(payload, /540580\.00/);
  assert.match(payload, /5917ZIIS TEC SERVICOS/);
  assert.match(payload, /6007ITAPEMA/);
  assert.equal(payload.slice(-4), crc16Pix(payload.slice(0, -4)));
});

test('F09 Pix: valor diferente gera payload diferente sem reutilizar QR fixo', () => {
  const a = buildPixPayload({ key:'pix@example.com', receiverName:'Ziis Tec Serviços', receiverCity:'Itapema', amount:80 });
  const b = buildPixPayload({ key:'pix@example.com', receiverName:'Ziis Tec Serviços', receiverCity:'Itapema', amount:81.5 });
  assert.notEqual(a, b);
  assert.match(b, /540581\.50/);
});

test('F09 Pix: configuração incompleta ou valor inválido é rejeitado antes do QR', () => {
  assert.throws(() => buildPixPayload({ key:'', receiverName:'ZiisTec', receiverCity:'Itapema', amount:80 }), /chave Pix/i);
  assert.throws(() => buildPixPayload({ key:'x', receiverName:'', receiverCity:'Itapema', amount:80 }), /nome do recebedor/i);
  assert.throws(() => buildPixPayload({ key:'x', receiverName:'ZiisTec', receiverCity:'', amount:80 }), /cidade/i);
  assert.throws(() => buildPixPayload({ key:'x', receiverName:'ZiisTec', receiverCity:'Itapema', amount:0 }), /maior que zero/i);
});

test('F09 Pix: QR local produz matriz Model 2 válida em tamanho esperado e SVG data URI', () => {
  const matrix = qrMatrixForText(expectedPayload);
  assert.equal(matrix.length, 49);
  assert.ok(matrix.every((row) => row.length === 49));
  assert.ok(matrix.flat().every((cell) => typeof cell === 'boolean'));
  assert.equal(matrix[0][0], true);
  assert.equal(matrix[1][1], false);
  assert.equal(matrix[3][3], true);
  assert.equal(matrix[0][48], true);
  assert.equal(matrix[48][0], true);

  const uri = pixQrSvgDataUri(expectedPayload);
  assert.match(uri, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.match(decodeURIComponent(uri), /<svg /);
  assert.match(decodeURIComponent(uri), /shape-rendering="crispEdges"/);
});
