import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowDir = path.join(root, '.github', 'workflows');
const failures = [];
const files = fs.existsSync(workflowDir)
  ? fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/i.test(name))
  : [];

for (const name of files) {
  const rel = `.github/workflows/${name}`;
  const text = fs.readFileSync(path.join(workflowDir, name), 'utf8');

  const forbiddenPermissions = [
    ['contents: write', /^\s*contents:\s*write\s*$/im],
    ['actions: write', /^\s*actions:\s*write\s*$/im],
    ['pull-requests: write', /^\s*pull-requests:\s*write\s*$/im],
    ['packages: write', /^\s*packages:\s*write\s*$/im],
    ['deployments: write', /^\s*deployments:\s*write\s*$/im],
    ['id-token: write', /^\s*id-token:\s*write\s*$/im],
  ];
  for (const [label, pattern] of forbiddenPermissions) {
    if (pattern.test(text)) failures.push(`${rel}: permissão desnecessária detectada: ${label}`);
  }

  if (/\bgit\s+push\b/i.test(text)) failures.push(`${rel}: workflow não pode fazer git push automático.`);
  if (/persist-credentials:\s*true/i.test(text)) failures.push(`${rel}: checkout não pode persistir credenciais.`);

  const checkoutMatches = [...text.matchAll(/uses:\s*actions\/checkout@[^\s]+/g)];
  for (const match of checkoutMatches) {
    const nearby = text.slice(match.index, match.index + 260);
    if (!/persist-credentials:\s*false/i.test(nearby)) {
      failures.push(`${rel}: actions/checkout precisa declarar persist-credentials: false.`);
    }
  }
}

if (!files.length) failures.push('Nenhum workflow GitHub encontrado para validar.');

if (failures.length) {
  console.error('\nWORKFLOW PERMISSIONS CHECK: FAIL\n');
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log('\nWORKFLOW PERMISSIONS CHECK: OK');
console.log(`✓ ${files.length} workflows verificados`);
console.log('✓ Sem workflow com escrita em conteúdo, push automático ou credencial persistida');
console.log('✓ security-events: write permanece permitido apenas para o CodeQL publicar resultados');
