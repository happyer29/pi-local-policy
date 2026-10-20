import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cache = mkdtempSync(join(tmpdir(), 'pi-policy-pack-check-'));
const expected = [
  '.github/CONTRIBUTING.md', '.github/SECURITY.md', 'LICENSE', 'README.md', 'package.json',
  'docs/architecture.md',
  ...['ru', 'zh-CN'].flatMap(lang => ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'architecture.md'].map(name => `docs/i18n/${lang}/${name}`)),
  'scripts/install.mjs', 'scripts/uninstall.mjs', 'scripts/management.mjs',
  'src/config.json', 'src/fs-worker.mjs', 'src/index.ts', 'src/policy.mjs', 'src/public-fetch.mjs', 'src/sandbox.mjs',
].sort();

try {
  const result = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', '--cache', cache], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }))[0];
  const actual = result.files.map(file => file.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const extra = actual.filter(file => !expected.includes(file));
    const missing = expected.filter(file => !actual.includes(file));
    throw new Error(`npm archive differs. Unexpected: ${extra.join(', ') || '(none)'}. Missing: ${missing.join(', ') || '(none)'}`);
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (result.id !== `${pkg.name}@${pkg.version}` || result.bundled?.length) throw new Error('Unexpected package identity or bundled dependencies');
  console.log(`npm archive OK: ${result.id}; ${actual.length} reviewed files; ${result.size} bytes packed; no bundled host dependencies.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(cache, { recursive: true, force: true });
}
