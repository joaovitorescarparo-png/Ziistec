from pathlib import Path

p=Path('scripts/verify-round31.mjs')
s=p.read_text()

def replace_once(old,new,label):
    global s
    count=s.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 anchor, found {count}')
    s=s.replace(old,new,1)

replace_once(
"  'const minVisibleRows = 6',\n",
"  'shouldBreakPdfBlock(y,rowH,SAFE_BOTTOM,12)',\n  'shouldBreakPdfBlock(y,signatureH,SAFE_BOTTOM)',\n  'ensure(infoCardH+closingGapH+signatureH)',\n",
'round34 measured pagination markers',
)
replace_once(
"if (!pdf.includes('while (fillerRows > 0 && y - 32 > 300)')) fail('PDF perdeu o preenchimento estrutural seguro para orçamentos com poucos itens');\nelse ok('PDF usa linhas vazias estruturadas para reduzir espaço solto sem inventar itens');\nif (!pdf.includes('if (y - signatureH < SAFE_BOTTOM) newPage(true);')) fail('PDF perdeu a proteção das assinaturas contra o rodapé');\nelse ok('Assinaturas respeitam zona segura e não podem invadir o rodapé');\n",
"if (pdf.includes('const minVisibleRows =') || pdf.includes('while (fillerRows > 0')) fail('PDF reintroduziu linhas artificiais que antecipam a paginação');\nelse ok('PDF one-page-first não inventa linhas para ocupar espaço');\nif (pdf.includes('SAFE_BOTTOM + 205')) fail('PDF reintroduziu reserva fixa excessiva de fechamento');\nelse ok('PDF usa altura medida em vez de reserva fixa de 205px');\nif (!pdf.includes('shouldBreakPdfBlock(y,signatureH,SAFE_BOTTOM)')) fail('PDF perdeu a proteção medida das assinaturas contra o rodapé');\nelse ok('Assinaturas respeitam zona segura por cálculo de altura');\n",
'round34 obsolete filler and signature checks',
)
replace_once(
"const pdf = read('api/quote-pdf.js');\n",
"const pdf = read('api/quote-pdf.js');\nconst pdfLayout = read('api/quotePdfLayout.js');\nif (!pdfLayout.includes('export function shouldBreakPdfBlock') || !pdfLayout.includes('export function canKeepClosingTogether')) fail('PDF perdeu helpers determinísticos de paginação calculada');\nelse ok('PDF mantém helpers determinísticos de paginação calculada');\n",
'round34 layout helper guard',
)
p.write_text(s)
print('RC1C_ROUND34_CONTRACT_ALIGNED=PASS')
