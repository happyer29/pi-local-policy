import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Explicit publication inventory. Changes to it should be reviewed like code.
const expected = [
  '.gitattributes', '.github/workflows/test.yml', '.gitignore',
  '.github/CONTRIBUTING.md', '.github/SECURITY.md', 'LICENSE', 'README.md',
  'docs/architecture.md',
  'docs/i18n/ru/README.md', 'docs/i18n/ru/SECURITY.md', 'docs/i18n/ru/CONTRIBUTING.md', 'docs/i18n/ru/architecture.md',
  'docs/i18n/zh-CN/README.md', 'docs/i18n/zh-CN/SECURITY.md', 'docs/i18n/zh-CN/CONTRIBUTING.md', 'docs/i18n/zh-CN/architecture.md',
  'package.json', 'package-lock.json', 'src/fs-worker.mjs', 'src/index.ts', 'src/config.json',
  'src/policy.mjs', 'src/public-fetch.mjs', 'src/sandbox.mjs',
  'scripts/check-release.mjs', 'scripts/check-package.mjs', 'scripts/install.mjs', 'scripts/management.mjs', 'scripts/uninstall.mjs',
  'tests/helpers/pi-sdk.mjs', 'tests/installer.test.mjs', 'tests/integration.test.mjs',
  'tests/policy.test.mjs', 'tests/public-fetch.test.mjs', 'tests/sandbox.test.mjs', 'tests/sdk-resolution.test.mjs', 'tests/config.test.mjs',
].sort();
const actual = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (dir === root && ['.git', 'node_modules'].includes(name)) continue;
    const path = join(dir, name), info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error(`Symlink in publication tree: ${relative(root, path)}`);
    if (info.isDirectory()) walk(path);
    else if (info.isFile()) actual.push(relative(root, path).replaceAll('\\', '/'));
    else throw new Error(`Unsupported publication entry: ${relative(root, path)}`);
  }
}

try {
  walk(root);
  actual.sort();
  const extra = actual.filter(p => !expected.includes(p));
  const missing = expected.filter(p => !actual.includes(p));
  if (extra.length || missing.length) throw new Error(`Publication inventory differs. Unexpected: ${extra.join(', ') || '(none)'}. Missing: ${missing.join(', ') || '(none)'}`);
  // A provenance check for accidental machine-specific paths, not a secret scanner.
  const machineHome = /\/(?:Users|home)\/[^/\s"'`]+|[A-Z]:\\Users\\[^\\\s"']+/;
  for (const name of actual) if (machineHome.test(readFileSync(join(root, name), 'utf8'))) throw new Error(`Machine-specific home path found in ${name}`);
  const config = JSON.parse(readFileSync(join(root, 'src', 'config.json'), 'utf8'));
  if (JSON.stringify(config) !== JSON.stringify({ version: 1, readRoots: [], askTools: {} })) throw new Error('Publication config must contain no personal grants');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.private === true) throw new Error('Public release is blocked by private: true');
  if (pkg.name !== 'pi-local-policy' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('Review the release name and version');
  if (!pkg.keywords?.includes('pi-package') || JSON.stringify(pkg.pi?.extensions) !== JSON.stringify(['./src/index.ts'])) throw new Error('Missing Pi package metadata');
  if (pkg.publishConfig?.access !== 'public' || pkg.publishConfig?.registry !== 'https://registry.npmjs.org/') throw new Error('Public npm registry must be explicit');
  if (JSON.stringify(pkg.os) !== JSON.stringify(['darwin'])) throw new Error('Only macOS is supported');
  if (!Array.isArray(pkg.files) || !pkg.files.includes('src/')) throw new Error('A reviewed npm files allowlist is required');
  if (['preinstall','install','postinstall','prepare','prepublish','prepublishOnly','publish','postpublish'].some(name => pkg.scripts?.[name])) throw new Error('Automatic install and publication hooks are not part of this release');
  console.log(`Publication inventory OK: ${actual.length} text files; no machine-specific home paths; empty personal grants; public Pi/npm metadata verified.`);
  console.log('This checks the declared inventory and configuration, not every possible secret or vulnerability.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
