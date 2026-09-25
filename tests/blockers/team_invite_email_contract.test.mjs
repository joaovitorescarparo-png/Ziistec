import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read=(p)=>readFileSync(p,'utf8');

test('team invite email function requires authenticated active owner',()=>{
  const edge=read('supabase/functions/team-invite-email/index.ts');
  const config=read('supabase/config.toml');
  assert.match(config,/\[functions\.team-invite-email\][\s\S]*verify_jwt\s*=\s*true/);
  assert.match(edge,/auth\.getUser\(\)/);
  assert.match(edge,/\.eq\("role", "owner"\)/);
  assert.match(edge,/\.eq\("status", "active"\)/);
  assert.match(edge,/owner_required/);
});

test('team invite delivery uses native Supabase Invite and server-only privilege',()=>{
  const edge=read('supabase/functions/team-invite-email/index.ts');
  const client=read('src/lib/dataApiExtras.js');
  assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge,/auth\.admin\.inviteUserByEmail/);
  assert.doesNotMatch(client,/SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.match(client,/supabase\.functions\.invoke\('team-invite-email'/);
  assert.match(client,/body:\{invite_id:inviteId,redirect_to:redirectTo\}/);
});

test('team invite redirect allowlist is exact for this staging branch',()=>{
  const edge=read('supabase/functions/team-invite-email/index.ts');
  assert.match(edge,/https:\/\/ziistec-git-hardening-v2-staging-js-connect\.vercel\.app/);
  assert.doesNotMatch(edge,/\*\.vercel|\*\*|ziistec\.vercel\.app/);
  assert.match(edge,/invalid_redirect/);
});

test('team invite origin allowlist is exact: hardening, RC-1D and existing local origins only',()=>{
  const edge=read('supabase/functions/team-invite-email/index.ts');
  const preamble=edge.slice(edge.indexOf('const STAGING_APP'),edge.indexOf('Deno.serve('));
  const {code}=transformSync(preamble,{loader:'ts'});
  const {ALLOWED_ORIGINS,normalizeRedirect}=new Function(`${code}\nreturn { ALLOWED_ORIGINS, normalizeRedirect };`)();
  const hardening='https://ziistec-git-hardening-v2-staging-js-connect.vercel.app';
  const rc1d='https://ziistec-git-rc1d-stabilization-js-connect.vercel.app';
  const local=['http://localhost:5173','http://127.0.0.1:5173'];
  assert.deepEqual([...ALLOWED_ORIGINS].sort(),[hardening,rc1d,...local].sort());
  for(const origin of ALLOWED_ORIGINS){
    assert.equal(new URL(origin).origin,origin);
    assert.doesNotMatch(origin,/\*/);
  }
  for(const origin of [hardening,rc1d,...local]) assert.equal(normalizeRedirect(`${origin}/`),`${origin}/`);
  for(const rejected of [
    'https://example.com/',
    'https://ziistec-git-rc1c-mobile-ux-stabilization-js-connect.vercel.app/',
    'https://ziistec-git-zz-probe-wildcard-js-connect.vercel.app/',
    'https://ziistec.vercel.app/',
    'http://ziistec-git-rc1d-stabilization-js-connect.vercel.app/',
    `${rc1d}/a/b`,
    `${rc1d}/?x=1`,
  ]) assert.equal(normalizeRedirect(rejected),'');
  assert.equal((edge.match(/ALLOWED_ORIGINS\.has\(origin\)/g)||[]).length,4);
  assert.doesNotMatch(edge,/Access-Control-Allow-Origin"\s*:\s*"\*"/);
});

test('technician email metadata does not expose private business fields',()=>{
  const edge=read('supabase/functions/team-invite-email/index.ts');
  const metadata=edge.slice(edge.indexOf('data: {'), edge.indexOf('});', edge.indexOf('data: {'))+3);
  assert.match(metadata,/invitee_name/);
  assert.match(metadata,/company_name/);
  assert.match(metadata,/role_label/);
  assert.doesNotMatch(metadata,/finance|cost|custo|margin|margem|supplier|fornecedor/i);
});

test('database invitation survives mail failure while F11 remains membership authority',()=>{
  const client=read('src/lib/dataApiExtras.js');
  const edge=read('supabase/functions/team-invite-email/index.ts');
  const f11=read('supabase/0080_require_confirmed_email_for_invite_acceptance.sql');
  assert.match(client,/company_invites'[\s\S]*insert\(payload\)/);
  assert.match(client,/emailDelivery=\{ok:false,sent:false,reason:'delivery_failed'\}/);
  assert.match(edge,/existing_user/);
  assert.match(f11,/email_confirmed_at is not null/i);
});
