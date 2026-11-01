import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const legacy=fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx',import.meta.url),'utf8');
test('OS mobile exposes one execution CTA and groups admin/destructive actions',()=>{
 assert.match(legacy,/const acaoPrincipal = acoes\.find/);
 assert.match(legacy,/<summary[^>]*>Mais<ChevronDown/);
 assert.match(legacy,/>Excluir OS<\/button>/); assert.match(legacy,/>Cancelar OS<\/button>/);
 assert.match(legacy,/Data e horário/); assert.match(legacy,/Endereco valor=\{os\.local\}/); assert.match(legacy,/Serviço<\/p>/);
});
test('shared mobile modal keeps safe areas, sticky footer and comfortable touch targets',()=>{
 assert.match(legacy,/max-h-\[calc\(100dvh-env\(safe-area-inset-top\)\)\]/);
 assert.match(legacy,/sticky bottom-0 bg-white/); assert.match(legacy,/pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/);
 assert.match(legacy,/const sizes = \{ sm: "min-h-11/);
});
