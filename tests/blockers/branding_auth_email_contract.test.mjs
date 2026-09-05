import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolverRedirectAuth } from '../../src/lib/authRedirect.js';

const read=(p)=>readFileSync(p,'utf8');
const templates=[
  'supabase/templates/confirmation.html',
  'supabase/templates/invite.html',
  'supabase/templates/recovery.html',
  'supabase/templates/password_changed_notification.html',
];

test('auth redirects are exact and fail closed',()=>{
  const staging='https://ziistec-git-hardening-v2-staging-js-connect.vercel.app';
  assert.equal(resolverRedirectAuth({origin:staging,hostname:'ziistec-git-hardening-v2-staging-js-connect.vercel.app'}),`${staging}/`);
  assert.equal(resolverRedirectAuth({origin:'http://ziistec-git-hardening-v2-staging-js-connect.vercel.app',hostname:'ziistec-git-hardening-v2-staging-js-connect.vercel.app'}),'');
  assert.equal(resolverRedirectAuth({origin:'https://ziistec-random-js-connect.vercel.app',hostname:'ziistec-random-js-connect.vercel.app'}),'');
  assert.equal(resolverRedirectAuth({origin:'http://localhost:5173',hostname:'localhost',isDev:false}),'');
  assert.equal(resolverRedirectAuth({origin:'http://localhost:5173',hostname:'localhost',isDev:true}),'http://localhost:5173/');
});

test('login uses the safe redirect for signup, recovery and OAuth',()=>{
  const login=read('src/screens/Login.jsx');
  assert.match(login,/redirectAuthAtual\(\)/);
  assert.match(login,/emailRedirectTo/);
  assert.match(login,/resetPasswordForEmail\(email\.trim\(\), \{ redirectTo \}\)/);
  assert.match(login,/signInWithOAuth[\s\S]*options: \{ redirectTo \}/);
  assert.doesNotMatch(login,/redirectTo:\s*window\.location\.origin/);
});

test('email templates keep Supabase authority and mobile-safe structure',()=>{
  for(const file of templates){
    const html=read(file);
    assert.match(html,/max-width:600px/);
    assert.match(html,/<table role="presentation"/);
    assert.match(html,/https:\/\//);
    assert.doesNotMatch(html,/base64/i);
    assert.doesNotMatch(html,/<script/i);
    assert.doesNotMatch(html,/fonts\.googleapis|@font-face/i);
  }
  for(const file of templates.slice(0,3)){
    const html=read(file);
    assert.match(html,/\{\{ \.ConfirmationURL \}\}/);
    assert.match(html,/word-break:break-all/);
  }
});

test('owner, invite and recovery copy are separated',()=>{
  const confirmation=read('supabase/templates/confirmation.html');
  const invite=read('supabase/templates/invite.html');
  const recovery=read('supabase/templates/recovery.html');
  const config=read('supabase/config.toml');
  assert.match(confirmation,/configuração da sua empresa/);
  assert.match(confirmation,/\.Data\.full_name/);
  assert.match(invite,/\.Data\.company_name/);
  assert.match(invite,/\.Data\.invitee_name/);
  assert.match(invite,/técnico\/colaborador|\.Data\.role_label/);
  assert.doesNotMatch(invite,/financeiro|custos?|margem|fornecedores?/i);
  assert.match(recovery,/Redefinir minha senha/);
  assert.match(config,/Confirme seu e-mail para começar na ZiisTec/);
  assert.match(config,/\{\{ \.Data\.company_name \}\} convidou você para a ZiisTec/);
  assert.match(config,/Redefina sua senha da ZiisTec/);
});

test('F11 authority remains explicit and unchanged in the runtime chain',()=>{
  const f11=read('supabase/0080_require_confirmed_email_for_invite_acceptance.sql');
  const sessao=read('src/lib/useSessao.js');
  assert.match(f11,/u\.id\s*=\s*v_uid[\s\S]*u\.email_confirmed_at is not null/i);
  assert.match(sessao,/rpc\("zt_accept_invites"\)/);
  assert.doesNotMatch(sessao,/email_confirmed_at\s*=|updateUser\([^)]*email_confirmed/i);
});

test('approved brand assets and legacy shell branding are wired',()=>{
  const index=read('index.html');
  const legacy=read('src/legacy/ZiisTecApp.jsx');
  assert.match(index,/\/brand\/ziistec-favicon\.png/);
  assert.match(index,/\/brand\/ziistec-icon\.png/);
  assert.match(legacy,/ROUND 4\.0 · identidade ZiisTec e convite por e-mail/);
  assert.match(legacy,/\/brand\/ziistec-icon\.png/);
});
