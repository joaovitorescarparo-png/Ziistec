import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const fail = (message) => {
  console.error(`PROJECT_GOVERNANCE: ${message}`);
  process.exitCode = 1;
};
const requireText = (text, needle, label) => {
  if (!text.includes(needle)) fail(`${label} is missing required marker: ${needle}`);
};
const lineCount = (text) => text.split(/\r?\n/).length;

const agents = read('AGENTS.md');
const claude = read('CLAUDE.md');
const memory = read('docs/engineering/PROJECT_MEMORY.md');
const protocol = read('docs/engineering/CHANGE_PROTOCOL.md');
const prTemplate = read('.github/pull_request_template.md');
const pkg = JSON.parse(read('package.json'));

// Keep always-loaded context high-signal instead of turning it into another wiki.
if (lineCount(agents) > 180) fail(`AGENTS.md has ${lineCount(agents)} lines; keep it at or below 180`);
if (lineCount(memory) > 130) fail(`PROJECT_MEMORY.md has ${lineCount(memory)} lines; keep it at or below 130`);

[
  ['hardening-v2-staging', 'AGENTS.md'],
  ['ui-v1-v2-merge', 'AGENTS.md'],
  ['`main`', 'AGENTS.md'],
  ['RLS/RPC/backend', 'AGENTS.md'],
  ['technician', 'AGENTS.md'],
  ['npm run verify:v2', 'AGENTS.md'],
  ['scripts/run-sql-rls-ci.sh', 'AGENTS.md'],
  ['src/legacy/ZiisTecApp.jsx', 'AGENTS.md'],
].forEach(([needle, label]) => requireText(agents, needle, label));

requireText(claude, '@AGENTS.md', 'CLAUDE.md');
requireText(claude, 'PROJECT_MEMORY.md', 'CLAUDE.md');
requireText(protocol, 'cenário concreto', 'CHANGE_PROTOCOL.md');
requireText(protocol, 'não editarem o mesmo arquivo', 'CHANGE_PROTOCOL.md');
requireText(protocol, 'node scripts/verify-project-governance.mjs', 'CHANGE_PROTOCOL.md');
requireText(memory, 'RLS/RPC é autoridade', 'PROJECT_MEMORY.md');
requireText(memory, 'Venda de campo', 'PROJECT_MEMORY.md');
requireText(prTemplate, 'Tenant isolation', 'pull request template');
requireText(prTemplate, 'Preview de Staging está READY', 'pull request template');

const verify = pkg.scripts?.['verify:v2'] || '';
if (!verify.includes('verify-project-governance.mjs')) {
  fail('package.json verify:v2 must execute scripts/verify-project-governance.mjs');
}
if (!pkg.scripts?.['verify:governance']) {
  fail('package.json must expose verify:governance for a fast standalone check');
}

// Shared rules must not become a secret store. These patterns intentionally
// target credential-shaped assignments, not prose that says "never commit secrets".
const docs = `${agents}\n${memory}\n${protocol}`;
const secretPatterns = [
  /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']{12,}/i,
  /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-.]{20,}["']/i,
  /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/i,
];
for (const pattern of secretPatterns) {
  if (pattern.test(docs)) fail(`governance docs contain credential-shaped content matching ${pattern}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('PROJECT GOVERNANCE: OK');
