import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install, uninstall, argumentsFor, RUNTIME } from '../scripts/management.mjs';

function fixture(t, settings) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pi-policy-installer-')));
  const agentDir = join(base, 'agent');
  mkdirSync(agentDir);
  if (settings !== undefined) writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(settings) + '\n');
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, agentDir, target: join(agentDir, 'extensions', 'local-policy'), settings: () => JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')) };
}
const mac = { skip: process.platform !== 'darwin' ? 'Installer applies only on macOS' : false };

test('installer preview creates no directories or settings and parses explicit CLI options', t => {
  const f = fixture(t);
  const before = readdirSync(f.agentDir);
  const plan = install({ agentDir: f.agentDir });
  assert.equal(plan.action, 'preview');
  assert.deepEqual(readdirSync(f.agentDir), before);
  assert.equal(existsSync(f.target), false);
  assert.deepEqual(argumentsFor(['--agent-dir', f.agentDir, '--apply'], 'install'), { action: 'install', apply: true, agentDir: f.agentDir });
  assert.throws(() => argumentsFor(['--agent-dir', 'relative'], 'install'), /absolute/);
  assert.throws(() => argumentsFor(['--wat'], 'install'), /Unknown/);
});

test('malformed settings and destination symlinks fail before mutations', t => {
  const f = fixture(t, { extensions: 'invalid' });
  assert.throws(() => install({ agentDir: f.agentDir, apply: true }), /extensions format/);
  assert.equal(existsSync(join(f.agentDir, 'backups')), false);
  writeFileSync(join(f.agentDir, 'settings.json'), '{}');
  mkdirSync(join(f.agentDir, 'extensions'));
  symlinkSync(join(f.base, 'missing'), f.target);
  assert.throws(() => install({ agentDir: f.agentDir }), /symlink/);
  assert.equal(existsSync(join(f.agentDir, 'backups')), false);
});

test('installation preserves unrelated settings, disabled extensions and existing policy config', mac, t => {
  const f = fixture(t, { model: 'offline-example', extensions: ['-/custom/approval.ts', '/other/extension.ts'], defaultTools: ['+codemode', 'read'], custom: { preserve: true } });
  const original = readFileSync(join(f.agentDir, 'settings.json'), 'utf8');
  mkdirSync(f.target, { recursive: true });
  writeFileSync(join(f.target, 'old.txt'), 'prior installation');
  const config = { version: 1, readRoots: ['/path/to/user-selected-materials'], askTools: {} };
  writeFileSync(join(f.target, 'config.json'), JSON.stringify(config));
  const result = install({ agentDir: f.agentDir, apply: true });
  assert.equal(readFileSync(join(result.backup, 'settings.json'), 'utf8'), original);
  assert.equal(readFileSync(join(result.backup, 'previous-extension', 'old.txt'), 'utf8'), 'prior installation');
  for (const name of RUNTIME) assert.ok(existsSync(join(f.target, name)));
  assert.deepEqual(JSON.parse(readFileSync(join(f.target, 'config.json'), 'utf8')), config);
  assert.equal(existsSync(join(f.target, 'tests')), false);
  assert.equal(existsSync(join(f.target, 'node_modules')), false);
  assert.ok(f.settings().extensions.includes('-/custom/approval.ts'));
  assert.deepEqual(f.settings().custom, { preserve: true });
  assert.deepEqual(f.settings().defaultTools, ['+local_codemode', 'read']);
  assert.throws(() => install({ agentDir: f.agentDir, apply: true }), /already exists/);
  const removed = uninstall({ agentDir: f.agentDir, apply: true });
  assert.deepEqual(f.settings(), JSON.parse(original));
  assert.equal(readFileSync(join(f.target, 'old.txt'), 'utf8'), 'prior installation');
  assert.ok(existsSync(join(removed.backup, 'removed-extension', 'index.ts')));
});

test('fresh install and uninstall restore absent settings fields and archive user config', mac, t => {
  const f = fixture(t);
  const result = install({ agentDir: f.agentDir, apply: true });
  assert.ok(existsSync(result.backup));
  assert.ok(f.settings().extensions.includes(join(f.target, 'index.ts')));
  writeFileSync(join(f.target, 'config.json'), '{"version":1,"readRoots":["/user/chosen/folder"]}\n');
  const before = readFileSync(join(f.agentDir, 'settings.json'), 'utf8');
  assert.equal(uninstall({ agentDir: f.agentDir }).action, 'preview');
  assert.equal(readFileSync(join(f.agentDir, 'settings.json'), 'utf8'), before);
  const removed = uninstall({ agentDir: f.agentDir, apply: true });
  assert.deepEqual(f.settings(), {});
  assert.equal(existsSync(f.target), false);
  assert.match(readFileSync(join(removed.backup, 'removed-extension', 'config.json'), 'utf8'), /user\/chosen/);
});

test('uninstall preserves later user edits and reports fields it cannot restore exactly', mac, t => {
  const f = fixture(t, { extensions: [], defaultTools: ['+codemode'], theme: 'before' });
  install({ agentDir: f.agentDir, apply: true });
  const edited = f.settings();
  edited.extensions.push('/new/user-extension.ts');
  edited.defaultTools.push('read');
  edited.theme = 'after';
  writeFileSync(join(f.agentDir, 'settings.json'), JSON.stringify(edited));
  const removed = uninstall({ agentDir: f.agentDir, apply: true });
  assert.equal(removed.warnings.length, 2);
  assert.ok(f.settings().extensions.includes('/new/user-extension.ts'));
  assert.ok(!f.settings().extensions.includes(join(f.target, 'index.ts')));
  assert.deepEqual(f.settings().defaultTools, ['read']);
  assert.equal(f.settings().theme, 'after');
});

test('uninstaller refuses unmanaged directories without removing files', t => {
  const f = fixture(t, {});
  mkdirSync(f.target, { recursive: true });
  writeFileSync(join(f.target, 'keep.txt'), 'keep');
  assert.throws(() => uninstall({ agentDir: f.agentDir, apply: true }), /No managed installation/);
  assert.equal(readFileSync(join(f.target, 'keep.txt'), 'utf8'), 'keep');
});
