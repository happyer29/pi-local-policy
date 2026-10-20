import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalPath, projectRoot, pathDecision, commandDecision, publicUrl, toolDecision } from '../src/policy.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'pi-local-policy-'));
const root = join(tmp, 'project'), scratch = join(tmp, 'scratch'), other = join(tmp, 'other');
for (const p of [root, scratch, other]) mkdirSync(p);
after(() => rmSync(tmp, { recursive: true, force: true }));
const ctx = { root, scratch };
test('ordinary project reads and writes are automatic', () => {
  assert.equal(pathDecision('src/new.ts', { ...ctx, write: true }).action, 'allow');
  assert.equal(pathDecision('src/new.ts', ctx).action, 'allow');
});
test('secret and control files remain protected', () => {
  for (const p of ['.env', '.env.local', 'auth.json', 'secrets.json', 'cert.pem', 'key.key', '.ssh/id_ed25519']) assert.equal(pathDecision(p, ctx).action, 'deny', p);
  for (const p of ['.git/config', '.git/hooks/pre-commit', '.pi/settings.json', '.PI/settings.json', '.agents/skills/x.md', 'AGENTS.md', 'agents.md']) assert.equal(pathDecision(p, { ...ctx, write: true }).action, 'deny', p);
});
test('outside paths, symlinks and missing descendants are checked canonically', () => {
  symlinkSync(other, join(root, 'escape'));
  assert.equal(pathDecision('escape/new.ts', { ...ctx, write: true }).action, 'deny');
  writeFileSync(join(other, 'ordinary.txt'), 'fixture');
  symlinkSync(join(other, 'ordinary.txt'), join(root, 'alias.txt'));
  assert.equal(pathDecision('alias.txt', ctx).action, 'deny');
  assert.equal(pathDecision('../other/new.ts', { ...ctx, write: true }).action, 'deny');
});
test('readonly grants never allow writes and secrets still lose', () => {
  assert.equal(pathDecision(join(other, 'ordinary.txt'), { ...ctx, readRoots: [other] }).action, 'allow');
  assert.equal(pathDecision(join(other, 'ordinary.txt'), { ...ctx, readRoots: [other], write: true }).action, 'deny');
  assert.equal(pathDecision(join(other, '.env'), { ...ctx, readRoots: [other] }).action, 'deny');
});
test('home/filesystem/general folders cannot become implicit writable roots', () => {
  assert.throws(() => projectRoot('/')); assert.throws(() => projectRoot(homedir()));
  assert.equal(projectRoot(root), canonicalPath(root));
});
test('system and shared toolchain folders cannot be writable projects', () => {
  for (const path of ['/usr', '/usr/bin', '/etc']) assert.throws(() => projectRoot(path), /system or shared toolchain/);
});
test('ordinary pipes and readonly git do not prompt', () => {
  for (const c of ['rg login src | head -n 10', 'git status --short', 'git diff', 'node --test', 'npm test']) assert.equal(commandDecision(c).action, 'allow', c);
});
test('external mutations and destructive/system commands do not pass ordinary bash', () => {
  for (const c of ['git push', 'npm publish', 'sudo true', 'git reset --hard', 'git push --force', 'osascript -e "x"']) assert.equal(commandDecision(c).action, 'deny', c);
  assert.equal(commandDecision('npm publish', { network: true }).action, 'ask');
});
test('public fetch refuses local/private/credential URLs', () => {
  assert.equal(publicUrl('https://example.com/docs'), true);
  for (const s of ['file:///etc/passwd', 'http://localhost:1234', 'http://127.0.0.1', 'http://192.168.0.1', 'http://[::1]', 'https://u:p@example.com', 'https://example.com/?token=x']) assert.equal(publicUrl(s), false, s);
});
test('tool name spoofing and unknown tools fail closed; codemode nested dispatch remains usable', () => {
  const config = { ownPath: '/trusted/index.ts', readSources: { web_search: '/trusted/search.ts' }, askSources: { browser_click: '/trusted/browser.ts' } };
  assert.equal(toolDecision('bash', {}, '/evil/index.ts', config).action, 'deny');
  assert.equal(toolDecision('bash', {}, config.ownPath, config).action, 'allow');
  assert.equal(toolDecision('codemode', {}, 'builtin:codemode', config).action, 'deny');
  assert.equal(toolDecision('local_codemode', {}, config.ownPath, config).action, 'allow');
  assert.equal(toolDecision('custom_exec', {}, '/trusted/custom.ts', config).action, 'deny');
  assert.equal(toolDecision('browser_click', {}, '/trusted/browser.ts', config).action, 'ask');
  assert.equal(toolDecision('web_search', {}, '/trusted/search.ts', config).action, 'allow');
});
test('automatic search grants require exact verified provenance and credential-free arguments', () => {
  const config = { ownPath: '/trusted/index.ts', readSources: { web_search: '/reviewed-package/search.ts' } };
  assert.equal(toolDecision('web_search', { query: 'public research' }, '/reviewed-package/search.ts', config).action, 'allow');
  for (const source of [undefined, '/other-package/search.ts', '/reviewed-package/search.ts/../other.ts']) {
    assert.equal(toolDecision('web_search', {}, source, config).action, 'deny');
  }
  assert.equal(toolDecision('web_search', {}, undefined, { ownPath: config.ownPath }).action, 'deny');
  assert.equal(toolDecision('web_search', { api_key: 'synthetic' }, '/reviewed-package/search.ts', config).action, 'deny');
  assert.equal(toolDecision('unknown_tool', {}, '/reviewed-package/search.ts', config).action, 'deny');
});
