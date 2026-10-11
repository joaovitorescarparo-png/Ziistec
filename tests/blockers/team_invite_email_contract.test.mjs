import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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

const previewOrigin='https://ziistec-git-codex-ziistec-assistant-mvp-v1-js-connect.vercel.app';
const stagingOrigin='https://ziistec-git-hardening-v2-staging-js-connect.vercel.app';
const rc1dOrigin='https://ziistec-git-rc1d-stabilization-js-connect.vercel.app';
const hostedOrigins=[stagingOrigin,rc1dOrigin,previewOrigin];
const acceptedOrigins=[...hostedOrigins,'http://localhost:5173','http://127.0.0.1:5173'];
const rejectedOrigins=[
  'https://unknown.example',
  ...hostedOrigins.flatMap(origin=>[
    `${origin}.evil.example`,
    origin.replace('https:', 'http:'),
    origin.replace('https:', 'ftp:'),
    `${origin}/invite`,
    `${origin}?invite=1`,
    `${origin}#invite`,
  ]),
  'javascript:alert(1)',
  '*',
  'https://*.vercel.app',
];

function loadInviteContract(){
  let handler;
  const edge=read('supabase/functions/team-invite-email/index.ts').replace(/^import .*;\r?\n/m,'');
  const {code}=transformSync(`${edge}\nglobalThis.normalizeRedirect=normalizeRedirect;`,{loader:'ts'});
  const context={
    URL,Response,
    Deno:{serve:(fn)=>{handler=fn;},env:{get:()=>{throw new Error('Contract must not access environment');}}},
    createClient:()=>{throw new Error('Contract must not access Supabase');},
  };
  runInNewContext(code,context);
  return {handler,normalizeRedirect:context.normalizeRedirect};
}

test('team invite redirect allows only exact approved origins and root redirects',()=>{
  const edge=read('supabase/functions/team-invite-email/index.ts');
  const {normalizeRedirect}=loadInviteContract();
  for(const origin of acceptedOrigins){
    assert.equal(normalizeRedirect(origin),`${origin}/`,origin);
    assert.equal(normalizeRedirect(`${origin}/`),`${origin}/`,origin);
  }
  for(const origin of rejectedOrigins) assert.equal(normalizeRedirect(origin),'',origin);
  assert.doesNotMatch(edge,/\*\.vercel|\*\*|ziistec\.vercel\.app/);
  assert.match(edge,/invalid_redirect/);
});

test('team invite preflight accepts exact origins and rejects malformed or wildcard origins',async()=>{
  const {handler}=loadInviteContract();
  for(const origin of acceptedOrigins){
    const response=await handler(new Request('https://edge.example',{method:'OPTIONS',headers:{Origin:origin}}));
    assert.equal(response.status,204,origin);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  }
  for(const origin of rejectedOrigins){
    for(const method of ['OPTIONS','POST']){
      const response=await handler(new Request('https://edge.example',{method,headers:{Origin:origin}}));
      assert.equal(response.status,403,`${method} ${origin}`);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
      assert.equal((await response.json()).error,'origin_not_allowed');
    }
  }
});

test('team invite rejects invalid redirects before accessing backend or sending email',async()=>{
  const {handler}=loadInviteContract();
  for(const redirect of rejectedOrigins){
    const response=await handler(new Request('https://edge.example',{
      method:'POST',
      headers:{Origin:previewOrigin,Authorization:'Bearer contract-test','Content-Type':'application/json'},
      body:JSON.stringify({invite_id:'00000000-0000-0000-0000-000000000001',redirect_to:redirect}),
    }));
    assert.equal(response.status,400,redirect);
    assert.equal((await response.json()).error,'invalid_redirect');
  }
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
