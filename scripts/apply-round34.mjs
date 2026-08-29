import { readFileSync, writeFileSync } from 'node:fs';

const file = 'api/quote-pdf.js';
let src = readFileSync(file, 'utf8');

if (src.includes('Marca-d\'água ampla e suave por trás do conteúdo.')) {
  console.log('Round 3.4 quote branding already applied');
  process.exit(0);
}

const requireOnce = (needle, replacement, label) => {
  const count = src.split(needle).length - 1;
  if (count !== 1) throw new Error(`Round 3.4 ${label}: expected 1 marker, got ${count}`);
  src = src.replace(needle, replacement);
};

requireOnce(
`    const newPage = (continuacao = false) => {
      page = pdf.addPage(A4);`,
`    // Marca-d'água ampla e suave por trás do conteúdo.
    // Depois que a logo é normalizada no frontend, o JPG/PNG antigo vira uma PNG recortada e transparente.
    const drawPageWatermark = () => {
      if (!logo) return;
      const wmW = 285;
      const wmH = 205;
      const wmX = (A4[0] - wmW) / 2 + 34;
      const wmY = 176;
      drawLogoFit(page, logo, wmX, wmY, wmW, wmH, 0.052);
    };

    const newPage = (continuacao = false) => {
      page = pdf.addPage(A4);
      drawPageWatermark();`,
'watermark helper',
);

requireOnce(
`    const companyTextX = logo ? margin + 116 : margin;
    if (logo) drawLogoFit(page, logo, margin, A4[1] - 94, 102, 54, 0.98);
    const companyLines = wrapText(companyName, bold, logo ? 12.5 : 18, logo ? 195 : 290).slice(0, 2);`,
`    const companyTextX = logo ? margin + 140 : margin;
    if (logo) drawLogoFit(page, logo, margin, A4[1] - 100, 128, 68, 1);
    const companyLines = wrapText(companyName, bold, logo ? 12.5 : 18, logo ? 170 : 290).slice(0, 2);`,
'top logo size',
);

requireOnce(
`    const minVisibleRows = 6;
    const fillerTop = y;
    let fillerRows = Math.max(0, minVisibleRows - (items || []).length);`,
`    const minVisibleRows = 6;
    let fillerRows = Math.max(0, minVisibleRows - (items || []).length);`,
'filler start',
);

requireOnce(
`    const fillerBottom = y;
    const watermarkBandH = fillerTop - fillerBottom;
    if (logo && watermarkBandH >= 64) {
      const wmW = 130;
      const wmH = Math.min(78, watermarkBandH - 10);
      const wmY = fillerBottom + (watermarkBandH - wmH) / 2 + 3;
      drawLogoFit(page, logo, tableRight - wmW - 14, wmY, wmW, wmH, 0.055);
    }

`,
``,
'remove filler-only watermark',
);

writeFileSync(file, src, 'utf8');
console.log('Applied Round 3.4 large clean watermark and larger header logo');
