import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_ADVISORY, auditCommand, auditEnvironment, evaluateAudit, parseAudit } from '../../scripts/security-audit.mjs';

const advisory = () => ({ name: 'braces', dependency: 'braces', severity: 'high', url: ALLOWED_ADVISORY });
const vulnerability = (name, via) => ({ name, severity: 'high', via, nodes: [`node_modules/${name}`], fixAvailable: { name: 'tailwindcss', version: '4.3.3', isSemVerMajor: true } });
function fixture() {
  const full = { vulnerabilities: { braces: vulnerability('braces', [advisory()]), micromatch: vulnerability('micromatch', ['braces']), tailwindcss: vulnerability('tailwindcss', ['micromatch']) } };
  const runtime = { vulnerabilities: {} };
  const lock = { lockfileVersion: 3, packages: Object.fromEntries(Object.keys(full.vulnerabilities).map((name) => [`node_modules/${name}`, { dev: true }])) };
  return { runtime, full, lock };
}
function result(vulnerabilities = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: Object.keys(vulnerabilities).length };
  for (const item of Object.values(vulnerabilities)) counts[item.severity]++;
  return { status: counts.high + counts.critical ? 1 : 0, stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } }) };
}

test('accepts only the development advisory and its transitive impact', () => {
  const { runtime, full, lock } = fixture();
  assert.deepEqual(evaluateAudit(runtime, full, lock), ['braces', 'micromatch', 'tailwindcss']);
  assert.deepEqual(evaluateAudit(runtime, runtime, lock), []);
  assert.doesNotThrow(() => parseAudit(result(full.vulnerabilities)));
});

for (const severity of ['high', 'critical']) test(`runtime ${severity} blocks even the allowed advisory`, () => {
  const { runtime, full, lock } = fixture();
  runtime.vulnerabilities.braces = { ...full.vulnerabilities.braces, severity };
  assert.throws(() => evaluateAudit(runtime, full, lock), /Runtime/);
});

for (const dev of [false, undefined, 'true']) test(`lockfile dev=${String(dev)} blocks exception`, () => {
  const { runtime, full, lock } = fixture();
  lock.packages['node_modules/micromatch'].dev = dev;
  assert.throws(() => evaluateAudit(runtime, full, lock), /Non-development/);
});

test('missing lockfile node and a second runtime copy both block', () => {
  const { runtime, full, lock } = fixture();
  delete lock.packages['node_modules/braces'];
  assert.throws(() => evaluateAudit(runtime, full, lock), /Non-development/);
  lock.packages['node_modules/braces'] = { dev: true };
  full.vulnerabilities.braces.nodes.push('node_modules/other/node_modules/braces');
  lock.packages['node_modules/other/node_modules/braces'] = {};
  assert.throws(() => evaluateAudit(runtime, full, lock), /Non-development/);
});

test('a new advisory in the same chain is blocked', () => {
  const { runtime, full, lock } = fixture();
  full.vulnerabilities.braces.via.push({ ...advisory(), url: 'https://github.com/advisories/GHSA-other' });
  assert.throws(() => evaluateAudit(runtime, full, lock), /Unapproved advisory/);
});

test('a runtime lockfile copy omitted from audit nodes still blocks', () => {
  const { runtime, full, lock } = fixture();
  lock.packages['node_modules/other/node_modules/braces'] = {};
  assert.throws(() => evaluateAudit(runtime, full, lock), /Non-development lockfile copy/);
});

test('an unrelated critical dependency is blocked', () => {
  const { runtime, full, lock } = fixture();
  full.vulnerabilities.other = { ...vulnerability('other', [{ ...advisory(), name: 'other' }]), severity: 'critical' };
  lock.packages['node_modules/other'] = { dev: true };
  assert.throws(() => evaluateAudit(runtime, full, lock), /Unapproved advisory/);
});

test('advisory identity, package and severity must match exactly', () => {
  for (const patch of [{ url: `${ALLOWED_ADVISORY}?bypass=1` }, { name: 'other' }, { dependency: 'other' }, { severity: 'critical' }]) {
    const { runtime, full, lock } = fixture();
    Object.assign(full.vulnerabilities.braces.via[0], patch);
    assert.throws(() => evaluateAudit(runtime, full, lock), /Unapproved advisory/);
  }
});

test('a patched braces remedy or unknown fix state blocks exception', () => {
  for (const fix of [true, undefined, { name: 'braces', version: '3.0.4', isSemVerMajor: false }]) {
    const { runtime, full, lock } = fixture();
    full.vulnerabilities.braces.fixAvailable = fix;
    assert.throws(() => evaluateAudit(runtime, full, lock), /Fix available/);
  }
});

test('cycles and dangling dependencies fail closed', () => {
  const { runtime, full, lock } = fixture();
  full.vulnerabilities.braces.via = ['tailwindcss'];
  assert.throws(() => evaluateAudit(runtime, full, lock), /Cyclic/);
  full.vulnerabilities.braces.via = ['missing'];
  assert.throws(() => parseAudit(result(full.vulnerabilities)), /Missing dependency/);
});

test('execution failures, timeouts, invalid JSON and registry errors fail closed', () => {
  for (const patch of [{ error: new Error('ENOENT') }, { signal: 'SIGTERM' }, { status: null }, { status: 2 }, { stdout: 'not json' }, { stdout: '{"error":{"code":"ENOTFOUND"}}' }]) {
    assert.throws(() => parseAudit({ ...result(), ...patch }));
  }
});

test('unknown schemas, incomplete advisories and inconsistent counts/status fail closed', () => {
  const { full } = fixture();
  for (const mutate of [
    (report) => { report.auditReportVersion = 3; },
    (report) => { delete report.metadata; },
    (report) => { report.metadata.vulnerabilities.high = 0; },
    (report) => { report.vulnerabilities.braces.via = []; },
    (report) => { report.vulnerabilities.braces.nodes = []; },
    (report) => { report.vulnerabilities.braces.via = [{}]; },
  ]) {
    const output = result(full.vulnerabilities);
    const report = JSON.parse(output.stdout);
    mutate(report);
    assert.throws(() => parseAudit({ ...output, stdout: JSON.stringify(report) }));
  }
  assert.throws(() => parseAudit({ ...result(), status: 1 }), /exit status/);
});

test('Windows uses ComSpec with no shell:true and runtime omission is explicit', () => {
  assert.deepEqual(auditCommand(true, 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }), {
    command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', 'npm audit --json --audit-level=high --include=optional --include=peer --include=prod --omit=dev'],
  });
  assert.equal(auditCommand(false, 'win32', {}).command, 'cmd.exe');
  assert.deepEqual(auditCommand(false, 'linux', {}), { command: 'npm', args: ['audit', '--json', '--audit-level=high', '--include=optional', '--include=peer', '--include=dev'] });
});

test('inherited npm scope cannot hide development findings or include them in runtime', () => {
  assert.deepEqual(auditEnvironment({ NODE_ENV: 'production', npm_config_include: 'dev', NPM_CONFIG_OMIT: 'dev', npm_config_production: 'true', npm_config_only: 'prod', npm_config_audit_level: 'critical', Path: 'kept' }), { NODE_ENV: 'development', Path: 'kept' });
});
