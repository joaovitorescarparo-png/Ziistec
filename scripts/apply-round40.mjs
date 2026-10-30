import { readFileSync, writeFileSync } from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let src=readFileSync(file,'utf8');
const MARK='ROUND 4.0 · identidade ZiisTec e convite por e-mail';
if(src.includes(MARK)){console.log('Round 4.0 already applied');process.exit(0);}

const replaceCount=(needle,replacement,expected,label)=>{
  const count=src.split(needle).length-1;
  if(count!==expected)throw new Error(`Round 4.0 ${label}: expected ${expected} markers, got ${count}`);
  src=src.split(needle).join(replacement);
};

replaceCount(
  '<div className="w-9 h-9 rounded-xl bg-teal-500 flex items-center justify-center shrink-0">\n        <span className="text-slate-900 font-bold text-lg leading-none">Z</span>\n      </div>',
  '<img src="/brand/ziistec-icon.png" alt="" aria-hidden="true" className="w-9 h-9 rounded-xl object-contain shrink-0" />',
  1,
  'desktop brand icon',
);

replaceCount(
  '<div className="w-7 h-7 rounded-lg bg-teal-500 flex items-center justify-center"><span className="text-slate-900 font-bold text-sm leading-none">Z</span></div>',
  '<img src="/brand/ziistec-icon.png" alt="" aria-hidden="true" className="w-7 h-7 rounded-lg object-contain" />',
  1,
  'mobile brand icon',
);

replaceCount(
  '<div className="w-7 h-7 rounded-lg bg-teal-500 flex items-center justify-center"><span className="text-slate-900 font-bold text-sm">Z</span></div>',
  '<img src="/brand/ziistec-icon.png" alt="" aria-hidden="true" className="w-7 h-7 rounded-lg object-contain" />',
  1,
  'platform brand icon',
);

replaceCount(
  'try { const eq = await convidarColaboradorDB({ nome, email, telefone, funcao, papel: pp }, empresaId, usuarioAtual?.id); setUsuarios(eq.usuarios); setMembresias(eq.membresias); aviso(`${nome} foi convidado para a equipe.`); return { convite: true }; }',
  'try { const eq = await convidarColaboradorDB({ nome, email, telefone, funcao, papel: pp }, empresaId, usuarioAtual?.id); setUsuarios(eq.usuarios); setMembresias(eq.membresias); const emailEnviado = Boolean(eq.emailDelivery?.sent); aviso(emailEnviado ? `Convite ZiisTec enviado para ${email.trim().toLowerCase()}.` : `${nome} foi adicionado como convite pendente. Se já tiver conta, pode entrar com o mesmo e-mail; o acesso só será ativado após a confirmação do e-mail.`); return { convite: true, emailEnviado }; }',
  1,
  'team invite delivery feedback',
);

replaceCount(
  'setCredencial({ nome: form.nome, email: form.email.trim().toLowerCase(), senha: r.senhaTemporaria || null, convite: Boolean(r.convite) });',
  'setCredencial({ nome: form.nome, email: form.email.trim().toLowerCase(), senha: r.senhaTemporaria || null, convite: Boolean(r.convite), emailEnviado: Boolean(r.emailEnviado) });',
  1,
  'team invite credential state',
);

replaceCount(
  '{credencial.convite ? <><p className="text-[13px] text-slate-600 leading-relaxed">Peça para {credencial.nome?.split(" ")[0]} criar ou entrar na conta com este mesmo e-mail. O ZiisTec vincula o acesso à sua empresa automaticamente.</p>',
  '{credencial.convite ? <><p className="text-[13px] text-slate-600 leading-relaxed">{credencial.emailEnviado ? `Enviamos um e-mail oficial da ZiisTec para ${credencial.email}. A pessoa deve confirmar o próprio e-mail antes de entrar na equipe.` : `O convite ficou pendente para ${credencial.email}. Se a pessoa já possui conta, basta entrar com esse mesmo e-mail confirmado.`}</p>',
  1,
  'team invite modal copy',
);

src += `\n/* ${MARK} */\n`;
writeFileSync(file,src,'utf8');
console.log('Applied Round 4.0 ZiisTec branding and invite email feedback');
