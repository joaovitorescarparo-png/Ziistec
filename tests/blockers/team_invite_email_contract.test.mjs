import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
