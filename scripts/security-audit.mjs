import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOWED_ADVISORY = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const demand = (condition, message) => { if (!condition) throw new Error(message); };

export function parseAudit(result) {
  demand(!result.error && !result.signal && [0, 1].includes(result.status), `npm audit failed to execute (status=${result.status}, code=${result.error?.code || 'none'}, signal=${result.signal || 'none'})`);
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error('npm audit returned invalid JSON'); }
  demand(object(report) && !report.error && report.auditReportVersion === 2 && object(report.vulnerabilities), 'Unsupported audit report');
  const counts = report.metadata?.vulnerabilities;
  demand(object(counts), 'Missing audit counts');
  const actual = Object.fromEntries(severities.map((severity) => [severity, 0]));
  for (const [name, item] of Object.entries(report.vulnerabilities)) {
    demand(object(item) && item.name === name && severities.includes(item.severity), 'Invalid vulnerability');
    demand(Array.isArray(item.via) && item.via.length > 0 && Array.isArray(item.nodes) && item.nodes.length > 0, `Incomplete vulnerability: ${name}`);
    demand(item.nodes.every((node) => typeof node === 'string' && node.startsWith('node_modules/')), `Invalid nodes: ${name}`);
    for (const via of item.via) {
      if (typeof via === 'string') {
        demand(Object.hasOwn(report.vulnerabilities, via), `Missing dependency: ${via}`);
      } else {
        demand(object(via) && typeof via.url === 'string' && typeof via.name === 'string' && severities.includes(via.severity), `Invalid advisory: ${name}`);
      }
    }
    actual[item.severity]++;
  }
  for (const severity of severities) demand(Number.isInteger(counts[severity]) && counts[severity] === actual[severity], `Inconsistent audit counts: ${severity}`);
  demand(counts.total === Object.keys(report.vulnerabilities).length, 'Inconsistent total');
  demand(result.status === (counts.high + counts.critical > 0 ? 1 : 0), 'Inconsistent npm audit exit status');
  return report;
}

export function evaluateAudit(runtime, full, lock) {
  demand(object(lock?.packages) && [2, 3].includes(lock.lockfileVersion), 'Unsupported lockfile');
  const blocking = (item) => ['high', 'critical'].includes(item.severity)
    || item.via.some((via) => object(via) && ['high', 'critical'].includes(via.severity));
  demand(!Object.values(runtime.vulnerabilities).some(blocking), 'Runtime HIGH/CRITICAL vulnerabilities are forbidden');
  const tolerated = new Set();
  function visit(name, trail = new Set()) {
    demand(!trail.has(name), `Cyclic audit dependency: ${name}`);
    const item = full.vulnerabilities[name];
    demand(item && !Object.hasOwn(runtime.vulnerabilities, name), `Exception is not exclusively development: ${name}`);
    demand(item.nodes.every((node) => lock.packages[node]?.dev === true), `Non-development or missing lockfile node: ${name}`);
    const copies = Object.entries(lock.packages).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
    demand(copies.length > 0 && copies.every(([, entry]) => entry.dev === true), `Non-development lockfile copy: ${name}`);
    // npm currently proposes replacing Tailwind 3 with 4, not a patched braces release.
    const fix = item.fixAvailable;
    demand(fix === false || (object(fix) && fix.name === 'tailwindcss' && fix.isSemVerMajor === true && typeof fix.version === 'string'), `Fix available or unknown remediation: ${name}`);
    const next = new Set([...trail, name]);
    for (const via of item.via) {
      if (typeof via === 'string') visit(via, next);
      else demand(via.url === ALLOWED_ADVISORY && via.name === 'braces' && via.dependency === 'braces' && name === 'braces' && via.severity === 'high', `Unapproved advisory: ${name}`);
    }
    tolerated.add(name);
  }
  for (const [name, item] of Object.entries(full.vulnerabilities)) if (blocking(item)) visit(name);
  return [...tolerated].sort();
}

export function auditCommand(runtime, platform = process.platform, env = process.env) {
  const args = ['audit', '--json', '--audit-level=high', '--include=optional', '--include=peer', ...(runtime ? ['--include=prod', '--omit=dev'] : ['--include=dev'])];
  return platform === 'win32'
    ? { command: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `npm ${args.join(' ')}`] }
    : { command: 'npm', args };
}

export function runAudit() {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const reports = [true, false].map((runtime) => {
    const { command, args } = auditCommand(runtime);
    return parseAudit(spawnSync(command, args, { cwd, env: auditEnvironment(), encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }));
  });
  const tolerated = evaluateAudit(...reports, lock);
  console.log('Runtime audit PASS: no HIGH/CRITICAL vulnerabilities.');
  console.log(tolerated.length ? `Full audit PASS with temporary development-only exception ${ALLOWED_ADVISORY}: ${tolerated.join(', ')}` : 'Full audit PASS: no HIGH/CRITICAL vulnerabilities.');
}

export function auditEnvironment(env = process.env) {
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => !['node_env', 'npm_config_include', 'npm_config_omit', 'npm_config_production', 'npm_config_only', 'npm_config_audit_level'].includes(key.toLowerCase()))), NODE_ENV: 'development' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runAudit(); } catch (error) {
    console.error(`Security audit FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
