import fs from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let s=fs.readFileSync(file,'utf8');
const once=(oldText,newText,label)=>{
  const i=s.indexOf(oldText); if(i<0) throw new Error(`phase9: não encontrei ${label}`);
  if(s.indexOf(oldText,i+1)>=0) throw new Error(`phase9: ${label} apareceu mais de uma vez`);
  s=s.slice(0,i)+newText+s.slice(i+oldText.length);
};

once(
  'import React, { useState, useRef, useEffect } from "react";\n',
  'import React, { useState, useRef, useEffect } from "react";\nimport { baixarOrcamentoPDF, compartilharOrcamentoPDF, suportaCompartilharArquivo } from "../lib/quotePdf";\n',
  'import do PDF'
);

const oldFn=`  const enviarWhats = () => {\n    const linhas = orc.itens.map((i) => \`• \${i.qtd}× \${i.nome} — \${brl(i.qtd * i.preco)}\`).join("\\n");\n    const txt = \`*\${empresa.nome}*\\nOrçamento \${orc.numero}\\n\\n\${linhas}\\n\\n*Total: \${brl(totalDoc(orc))}*\\nValidade: \${dataBR(orc.validade)}\\n\${orc.condicao}\`;\n    window.open(\`https://wa.me/55\${soDigitos(c?.whatsapp)}?text=\${encodeURIComponent(txt)}\`, "_blank");\n    if (orc.status === "rascunho") mudarStatusOrc(orc.id, "enviado"); else aviso("Mensagem aberta no WhatsApp");\n  };`;
const newFn=`  const [gerandoPdf, setGerandoPdf] = useState(false);\n  const arquivoPdf = \`Orcamento-\${orc.numero}.pdf\`;\n  const textoWhats = () => {\n    const linhas = orc.itens.map((i) => \`• \${i.qtd}× \${i.nome} — \${brl(i.qtd * i.preco)}\`).join("\\n");\n    return \`*\${empresa.nome}*\\nOrçamento \${orc.numero}\\n\\n\${linhas}\\n\\n*Total: \${brl(totalDoc(orc))}*\\nValidade: \${dataBR(orc.validade)}\\n\${orc.condicao}\`;\n  };\n  const baixarPdf = async () => {\n    if (gerandoPdf) return;\n    setGerandoPdf(true);\n    try {\n      await baixarOrcamentoPDF(orc.id, orc.empresaId, arquivoPdf);\n      aviso(\"PDF gerado a partir do orçamento salvo no sistema.\");\n    } catch (e) { aviso(e?.message || \"Não foi possível gerar o PDF.\"); }\n    finally { setGerandoPdf(false); }\n  };\n  const enviarWhats = async () => {\n    if (gerandoPdf) return;\n    const txt = textoWhats();\n    if (suportaCompartilharArquivo()) {\n      setGerandoPdf(true);\n      try {\n        const r = await compartilharOrcamentoPDF({ quoteId: orc.id, companyId: orc.empresaId, filename: arquivoPdf, text: txt });\n        if (r.shared) {\n          if (orc.status === \"rascunho\") await mudarStatusOrc(orc.id, \"enviado\");\n          else aviso(\"PDF compartilhado.\");\n        }\n      } catch (e) { aviso(e?.message || \"Não foi possível compartilhar o PDF.\"); }\n      finally { setGerandoPdf(false); }\n      return;\n    }\n    const numero = soDigitos(c?.whatsapp);\n    if (!numero) {\n      setGerandoPdf(true);\n      try { await baixarOrcamentoPDF(orc.id, orc.empresaId, arquivoPdf); aviso(\"Cliente sem WhatsApp cadastrado. PDF baixado para envio manual.\"); }\n      catch (e) { aviso(e?.message || \"Não foi possível gerar o PDF.\"); }\n      finally { setGerandoPdf(false); }\n      return;\n    }\n    window.open(\`https://wa.me/55\${numero}?text=\${encodeURIComponent(txt)}\`, \"_blank\");\n    setGerandoPdf(true);\n    try {\n      await baixarOrcamentoPDF(orc.id, orc.empresaId, arquivoPdf);\n      if (orc.status === \"rascunho\") await mudarStatusOrc(orc.id, \"enviado\");\n      aviso(\"WhatsApp aberto e PDF baixado para anexar.\");\n    } catch (e) { aviso(\"WhatsApp aberto. Não consegui baixar o PDF: \" + (e?.message || \"erro de geração\")); }\n    finally { setGerandoPdf(false); }\n  };`;
once(oldFn,newFn,'função enviarWhats');

once(
  '<Btn variant="soft" size="sm" icon={Printer} onClick={() => window.print()}>Imprimir ou salvar PDF</Btn>',
  '<Btn variant="soft" size="sm" icon={gerandoPdf ? Loader2 : Printer} disabled={gerandoPdf} onClick={baixarPdf}>{gerandoPdf ? "Gerando PDF…" : "Gerar PDF"}</Btn>',
  'botão PDF'
);

fs.writeFileSync(file,s);
console.log('Applied ZiisTec phase 9 secure quote PDF patch (3 changes)');
