import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPolicyConfig, validatePolicyConfig } from '../src/policy.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-policy-config-'));
  const agentDir = join(root, 'agent'), extensionDir = join(root, 'package', 'src');
  mkdirSync(agentDir); mkdirSync(extensionDir, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const persistent = join(agentDir, 'local-policy.json'), packaged = join(extensionDir, 'config.json');
  return { agentDir, extensionDir, persistent, packaged };
}

test('persistent profile configuration wins over legacy package-local configuration', t => {
  const f = fixture(t);
  writeFileSync(f.packaged, JSON.stringify({ version: 1, readRoots: ['/legacy/materials'] }));
  writeFileSync(f.persistent, JSON.stringify({ version: 1, readRoots: ['/persistent/materials'], readTools: { web_search: '/reviewed/search/index.ts' } }));
  const loaded = loadPolicyConfig(f);
  assert.equal(loaded.file, f.persistent);
  assert.deepEqual(loaded.config.readRoots, ['/persistent/materials']);
  assert.deepEqual(loaded.config.readTools, { web_search: '/reviewed/search/index.ts' });
});

test('legacy flat installs retain package-local configuration; missing files use closed defaults', t => {
  const f = fixture(t);
  const defaults = { version: 1, readRoots: [], readTools: {}, askTools: {} };
  assert.deepEqual(loadPolicyConfig(f).config, defaults);
  writeFileSync(f.packaged, JSON.stringify({ version: 1, askTools: { browser_click: '/reviewed/browser/index.ts' } }));
  assert.equal(loadPolicyConfig(f).file, f.packaged);
  assert.deepEqual(loadPolicyConfig(f).config.askTools, { browser_click: '/reviewed/browser/index.ts' });
});

test('invalid persistent configuration fails closed rather than reverting to packaged grants', t => {
  const f = fixture(t);
  writeFileSync(f.packaged, JSON.stringify({ version: 1, readRoots: ['/broad/legacy/grant'] }));
  writeFileSync(f.persistent, '{broken JSON with synthetic-private-value');
  assert.throws(() => loadPolicyConfig(f), error => {
    assert.match(error.message, /Invalid JSON/);
    assert.doesNotMatch(error.message, /synthetic-private-value/);
    return true;
  });
  writeFileSync(f.persistent, '{"version":2}');
  assert.throws(() => loadPolicyConfig(f), /Unsupported/);
});

test('configuration rejects misspelled fields, null values, relative paths and arbitrary automatic tools', () => {
  for (const value of [
    null, [], false, { readRoot: [] }, { version: null }, { version: 2 },
    { readRoots: null }, { readRoots: false }, { readRoots: ['relative'] }, { readRoots: ['~/materials'] },
    { askTools: null }, { askTools: [] }, { askTools: { browser_click: 'relative/index.ts' } },
    { readTools: null }, { readTools: { custom_executor: '/trusted/custom.ts' } },
    { readTools: { web_search: '/trusted/search.ts' }, askTools: { web_search: '/trusted/search.ts' } },
    { readTools: { web_search: '/path/with\0nul' } },
  ]) assert.throws(() => validatePolicyConfig(value), undefined, JSON.stringify(value));
  assert.deepEqual(validatePolicyConfig({ readTools: { web_search: '/trusted/search.ts' } }).readTools, { web_search: '/trusted/search.ts' });
});
