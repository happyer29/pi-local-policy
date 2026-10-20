import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { locatePiSdk, loadPiTestApi, SDK_PACKAGE } from './helpers/pi-sdk.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pi-sdk-resolution-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('only an absent optional npm package returns no SDK', async () => {
  const missing = Object.assign(new Error('package absent'), { code: 'ERR_MODULE_NOT_FOUND' });
  assert.equal(await locatePiSdk({ env: {}, resolve: () => { throw missing; } }), null);
  const incompatible = Object.assign(new Error('no import export'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  await assert.rejects(locatePiSdk({ env: {}, resolve: () => { throw incompatible; } }), error => error === incompatible);
});

test('explicit SDK override validates its package rather than silently skipping', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: SDK_PACKAGE }));
  assert.equal(await locatePiSdk({ env: { PI_CODING_AGENT_ROOT: root } }), root);
  await assert.rejects(locatePiSdk({ env: { PI_CODING_AGENT_ROOT: '' } }), /must name/);
  await assert.rejects(locatePiSdk({ env: { PI_CODING_AGENT_ROOT: join(root, 'absent') } }), { code: 'ENOENT' });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'another-package' }));
  await assert.rejects(locatePiSdk({ env: { PI_CODING_AGENT_ROOT: root } }), /Expected package/);
});

test('normal npm import resolution discovers package root without requiring manifest exports', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: SDK_PACKAGE }));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.js'), '');
  const entry = pathToFileURL(join(root, 'dist/index.js')).href;
  assert.equal(await locatePiSdk({ env: {}, resolve: specifier => {
    assert.equal(specifier, SDK_PACKAGE);
    return entry;
  } }), root);
});

test('malformed installed SDK and missing SDK dependencies are failures', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'package.json'), '{ invalid json');
  await assert.rejects(locatePiSdk({ env: { PI_CODING_AGENT_ROOT: root } }), SyntaxError);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: SDK_PACKAGE }));
  await assert.rejects(loadPiTestApi(root), /Cannot find module|not found/);
});
