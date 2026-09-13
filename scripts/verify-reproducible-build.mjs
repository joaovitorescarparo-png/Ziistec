import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

const run = (command, args, options = {}) => spawnSync(command, args, {
  encoding: 'utf8',
  ...options,
});

const status = () => {
  const result = run('git', ['status', '--porcelain']);
  if (result.status !== 0) throw new Error(result.stderr || 'git status failed');
  return result.stdout;
};

const tracked = () => {
  const result = run('git', ['ls-files', '-z']);
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  return result.stdout.split('\0').filter(Boolean);
};

const snapshotMtimes = (paths) => new Map(paths.map((path) => {
  const stat = statSync(path, { bigint: true });
  return [path, stat.mtimeNs];
}));

const beforeStatus = status();
if (beforeStatus) {
  console.error('REPRODUCIBLE_BUILD: working tree must be clean before build');
  console.error(beforeStatus);
  process.exit(1);
}

const paths = tracked();
const beforeMtimes = snapshotMtimes(paths);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);

const afterStatus = status();
const touched = paths.filter((path) => statSync(path, { bigint: true }).mtimeNs !== beforeMtimes.get(path));
if (afterStatus || touched.length) {
  console.error('REPRODUCIBLE_BUILD: build wrote to tracked source');
  if (afterStatus) console.error(afterStatus);
  if (touched.length) console.error(`Touched tracked files:\n${touched.join('\n')}`);
  process.exit(1);
}

console.log('REPRODUCIBLE_BUILD: PASS — build left tracked files untouched and git status clean');
