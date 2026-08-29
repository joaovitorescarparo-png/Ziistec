import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const appFile = 'src/legacy/ZiisTecApp.jsx';
const pdfFile = 'api/quote-pdf.js';
const APP_PRE = '91edc5619d96a8ece1b6172b084d2426a128baa1a7334c3c5ebe2f6cb5bdefd4';
const APP_POST = '91703a73ba189664e01af2bcb899eb72cc2fc5fb5f896248416b4725fbf62d24';
const hash = (v) => createHash('sha256').update(v).digest('hex');

let app = readFileSync(appFile, 'utf8');
if (hash(app) !== APP_PRE) throw new Error(`Round 3.2 expected Round 3.1 source ${APP_PRE}, got ${hash(app)}`);

function appOnce(re, value, label) {
  const matches = [...app.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  if (matches.length !== 1) throw new Error(`Round 3.2 app ${label}: expected 1 match, got ${matches.length}`);
  app = app.replace(re, value);
}

// No tablet, a faixa azul inteira funciona como gaveta por gesto.
appOnce(
  /const \[menuExpandido, setMenuExpandido\] = useState\(false\);\n  const \[busca, setBusca\]/,
  'const [menuExpandido, setMenuExpandido] = useState(false);\n  const menuTouchX = useRef(null);\n  const [busca, setBusca]',
  'touch state',
);

const oldAside = `      <aside className={cx("zt-nao-imprime hidden md:flex fixed inset-y-0 left-0 z-30 bg-slate-900 flex-col transition-[width] duration-200", menuExpandido ? "md:w-[248px]" : "md:w-[72px] lg:w-[248px]")}>
        <Marca rail />
        <button onClick={() => setMenuExpandido((v) => !v)} aria-label={menuExpandido ? "Recolher menu" : "Expandir menu"} title={menuExpandido ? "Recolher menu" : "Mostrar nomes das funções"}
          className={cx("hidden md:flex lg:hidden absolute -right-3 top-[78px] w-7 h-7 rounded-full bg-white shadow ring-1 ring-slate-200 items-center justify-center text-slate-600 hover:text-slate-900", ring)}>
          <ChevronRight className={cx("w-4 h-4 transition-transform", menuExpandido && "rotate-180")} />
        </button>
        <Nav rail /><Empresa rail />
      </aside>`;

const newAside = `      <aside
        className={cx("zt-nao-imprime hidden md:flex fixed inset-y-0 left-0 z-30 bg-slate-900 flex-col transition-[width] duration-200 select-none", menuExpandido ? "md:w-[248px]" : "md:w-[72px] lg:w-[248px]")}
        style={{ touchAction: "pan-y" }}
        onTouchStart={(e) => { if (window.innerWidth < 1024) menuTouchX.current = e.touches?.[0]?.clientX ?? null; }}
        onTouchMove={(e) => {
          if (window.innerWidth >= 1024 || menuTouchX.current == null) return;
          const atual = e.touches?.[0]?.clientX ?? menuTouchX.current;
          const delta = atual - menuTouchX.current;
          if (delta > 38) { setMenuExpandido(true); menuTouchX.current = atual; }
          if (delta < -38) { setMenuExpandido(false); menuTouchX.current = atual; }
        }}
        onTouchEnd={() => { menuTouchX.current = null; }}
        aria-label="Menu lateral: arraste para abrir ou recolher"
      >
        <Marca rail /><Nav rail /><Empresa rail />
      </aside>`;

if (!app.includes(oldAside)) throw new Error('Round 3.2 sidebar source marker not found');
app = app.replace(oldAside, newAside);
const appHash = hash(app);
if (appHash !== APP_POST) throw new Error(`Round 3.2 final app integrity check failed: ${appHash}`);
writeFileSync(appFile, app, 'utf8');
console.log(`Applied Round 3.2 sidebar gesture (${appHash})`);

let pdf = readFileSync(pdfFile, 'utf8');
const pdfAlreadyApplied = pdf.includes('const txtRight =')
  && pdf.includes('Tabela com grade visual consistente e números alinhados pela direita.')
  && !pdf.includes('drawWatermark(page)');

if (!pdfAlreadyApplied) {
  function pdfOnce(re, value, label) {
    const matches = [...pdf.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
    if (matches.length !== 1) throw new Error(`Round 3.2 pdf ${label}: expected 1 match, got ${matches.length}`);
    pdf = pdf.replace(re, value);
  }

  // A logo fica no cabeçalho. Não usamos a imagem inteira como marca-d'água porque
  // arquivos enviados por clientes podem conter fundo, captura de tela ou arte quadrada.
  pdfOnce(
    /    const drawWatermark = \(pg\) => \{[\s\S]*?    \};\n    const txt =/,
    '    const txt =',
    'remove unsafe watermark helper',
  );
  pdfOnce(/      drawWatermark\(page\);\n/, '', 'remove watermark call');

  pdfOnce(
    /    const txt = \(t, x, yy, size = 9, font = normal, color = ink\) => pg\(\)\.drawText\(clean\(t\), \{ x, y: yy, size, font, color \}\);\n    const pg = \(\) => page;/,
    `    const txt = (t, x, yy, size = 9, font = normal, color = ink) => pg().drawText(clean(t), { x, y: yy, size, font, color });
    const txtRight = (t, right, yy, size = 9, font = normal, color = ink) => {
      const value = clean(t);
      const width = font.widthOfTextAtSize(value, size);
      pg().drawText(value, { x: Math.max(margin, right - width), y: yy, size, font, color });
    };
    const pg = () => page;`,
    'right aligned text helper',
  );

  pdfOnce(
    /    \/\/ Tabela\.[\s\S]*?    y -= 8;\n    ensure\(120\);/,
    `    // Tabela com grade visual consistente e números alinhados pela direita.
    const tableRight = A4[0] - margin;
    const col = { desc: margin + 8, qtyRight: margin + 350, unitRight: margin + 438, totalRight: tableRight - 8 };
    page.drawRectangle({ x: margin, y: y - 23, width: contentW, height: 28, color: navy });
    txt('DESCRIÇÃO', col.desc, y - 14, 8.5, bold, white);
    txtRight('QTD', col.qtyRight, y - 14, 8.5, bold, white);
    txtRight('PREÇO UNI.', col.unitRight, y - 14, 8.5, bold, white);
    txtRight('TOTAL', col.totalRight, y - 14, 8.5, bold, white);
    y -= 38;

    let subtotal = 0;
    let rowIndex = 0;
    for (const item of items || []) {
      const qty = Number(item.quantity || 0), unit = Number(item.unit_price || 0), total = qty * unit;
      subtotal += total;
      const desc = wrapText(item.name || 'Item', normal, 9.2, 270);
      const notes = item.notes ? wrapText(item.notes, normal, 7.5, 270) : [];
      const rowH = Math.max(40, desc.length * 12 + notes.length * 9 + 15);
      ensure(rowH + 8);
      if (rowIndex % 2 === 1) page.drawRectangle({ x: margin, y: y - rowH + 8, width: contentW, height: rowH + 2, color: soft });
      let yy = y;
      for (const l of desc) { txt(l, col.desc, yy, 9.2, normal, ink); yy -= 12; }
      for (const l of notes) { txt(l, col.desc, yy, 7.5, normal, muted); yy -= 9; }
      const qtdTxt = `${qty.toLocaleString('pt-BR')} ${clean(item.unit || '')}`.trim();
      txtRight(qtdTxt, col.qtyRight, y, 8.5, normal, muted);
      txtRight(money(unit), col.unitRight, y, 8.5, normal, ink);
      txtRight(money(total), col.totalRight, y, 8.5, bold, ink);
      y -= rowH;
      page.drawLine({ start: { x: margin, y: y + 7 }, end: { x: tableRight, y: y + 7 }, thickness: 0.45, color: line });
      rowIndex += 1;
    }

    y -= 8;
    ensure(120);`,
    'table alignment redesign',
  );

  pdfOnce(
    /    txt\(money\(grand\), A4\[0\] - margin - 118, y - 4, 15, bold, white\);/,
    '    txtRight(money(grand), A4[0] - margin - 14, y - 4, 15, bold, white);',
    'grand total alignment',
  );

  writeFileSync(pdfFile, pdf, 'utf8');
  console.log('Applied Round 3.2 premium PDF alignment and watermark cleanup');
} else {
  console.log('Round 3.2 premium PDF already applied; keeping verified result');
}

console.log(`Round 3.2 final app hash ${appHash}`);
