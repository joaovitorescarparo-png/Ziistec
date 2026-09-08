import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');

test('auth and onboarding use the mobile visual viewport without shrinking controls',()=>{
  for(const file of ['src/screens/Login.jsx','src/screens/NovaSenha.jsx','src/screens/Onboarding.jsx']){
    const src=read(file);
    assert.match(src,/min-h-\[100dvh\]/,`${file} must use dynamic viewport height`);
    assert.match(src,/overflow-x-hidden/,`${file} must guard horizontal overflow`);
    assert.match(src,/min-h-11/,`${file} must preserve touch-size controls`);
  }
  const login=read('src/screens/Login.jsx');
  assert.match(login,/role="alert"/);
  assert.match(login,/role="status"/);
  const onboarding=read('src/screens/Onboarding.jsx');
  assert.match(onboarding,/min-\[390px\]:grid-cols-2/);
});

test('legacy shell mobile contract survives reassembly and readable codemods',()=>{
  const src=read('src/legacy/ZiisTecApp.jsx');
  assert.match(src,/MOBILE HOMOLOGATION · shell\/nav\/dashboard · wave 1/);
  assert.match(src,/max-h-\[92dvh\]/);
  assert.doesNotMatch(src,/max-h-\[92vh\]/);
  assert.match(src,/pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(src,/min-h-14 flex flex-col items-center justify-center/);
  assert.match(src,/min-h-11 min-w-11/);
  assert.match(src,/min-h-\[100dvh\] overflow-x-hidden bg-slate-50/);
});

test('V2 workspace home preserves touch targets and mobile width',()=>{
  const src=read('src/screens/v2/WorkspaceV2Home.jsx');
  assert.match(src,/min-h-\[100dvh\] overflow-x-hidden/);
  assert.match(src,/min-h-11 min-w-11/);
  assert.match(src,/focus-visible:ring-2/);
});

test('client and quote V2 screens use dynamic viewport and touch-safe actions',()=>{
  const clients=read('src/screens/v2/ClientLocationsV2.jsx');
  assert.match(clients,/MOBILE HOMOLOGATION · clients · wave 2/);
  assert.match(clients,/min-h-\[100dvh\] overflow-x-hidden/);
  assert.match(clients,/min-h-11 min-w-11/);
  assert.match(clients,/min-h-11 flex-1 items-center justify-center/);

  const authoring=read('src/screens/v2/QuoteAIV2.jsx');
  assert.match(authoring,/MOBILE HOMOLOGATION · quote authoring · wave 2/);
  assert.match(authoring,/max-h-\[92dvh\]/);
  assert.match(authoring,/min-h-11 items-center justify-center/);
  assert.doesNotMatch(authoring,/\bmin-h-screen\b/);

  const management=read('src/screens/v2/QuotesManagementV2.jsx');
  assert.match(management,/MOBILE HOMOLOGATION · quote management · wave 2/);
  assert.match(management,/max-h-\[92dvh\]/);
  assert.match(management,/min-h-11 rounded-xl/);
  assert.doesNotMatch(management,/max-h-\[92vh\]/);
  assert.doesNotMatch(management,/\bmin-h-screen\b/);
});
