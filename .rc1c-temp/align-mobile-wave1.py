from pathlib import Path

p = Path('tests/blockers/mobile_wave1_contract.test.mjs')
s = p.read_text()
old = '''test('legacy shell mobile contract survives reassembly and readable codemods',()=>{\n  const src=read('src/legacy/ZiisTecApp.jsx');\n  assert.match(src,/MOBILE HOMOLOGATION · shell\\/nav\\/dashboard · wave 1/);\n  assert.match(src,/max-h-\\[92dvh\\]/);\n  assert.doesNotMatch(src,/max-h-\\[92vh\\]/);\n  assert.match(src,/pb-\\[env\\(safe-area-inset-bottom\\)\\]/);\n  assert.match(src,/min-h-14 flex flex-col items-center justify-center/);\n  assert.match(src,/min-h-11 min-w-11/);\n  assert.match(src,/min-h-\\[100dvh\\] overflow-x-hidden bg-slate-50/);\n});\n'''
new = '''test('legacy shell mobile contract survives reassembly and readable codemods',()=>{\n  const src=read('src/legacy/ZiisTecApp.jsx');\n  assert.match(src,/MOBILE HOMOLOGATION · shell\\/nav\\/dashboard · wave 1/);\n  assert.match(src,/max-h-\\[calc\\(100dvh-env\\(safe-area-inset-top\\)\\)\\]/);\n  assert.match(src,/pt-\\[env\\(safe-area-inset-top\\)\\]/);\n  assert.match(src,/min-h-0 overflow-y-auto overscroll-contain/);\n  assert.match(src,/sticky bottom-0/);\n  assert.match(src,/pb-\\[max\\(1rem,env\\(safe-area-inset-bottom\\)\\)\\]/);\n  assert.doesNotMatch(src,/max-h-\\[92vh\\]/);\n  assert.match(src,/min-h-14 flex flex-col items-center justify-center/);\n  assert.match(src,/min-h-11 min-w-11/);\n  assert.match(src,/min-h-\\[100dvh\\] overflow-x-hidden bg-slate-50/);\n});\n'''
count = s.count(old)
if count != 1:
    raise SystemExit(f'legacy shell contract anchor: expected exactly 1 block, found {count}')
s = s.replace(old, new, 1)
p.write_text(s)
print('RC1C_MOBILE_WAVE1_CONTRACT_ALIGNED=PASS')
