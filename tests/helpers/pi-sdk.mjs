import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve as absolutePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SDK_PACKAGE = '@earendil-works/pi-coding-agent';

/** Return null only when the optional npm dependency is genuinely absent. */
export async function locatePiSdk({ env = process.env, resolve = specifier => import.meta.resolve(specifier) } = {}) {
  if (env.PI_CODING_AGENT_ROOT !== undefined) {
    if (!env.PI_CODING_AGENT_ROOT.trim()) throw new Error('PI_CODING_AGENT_ROOT must name a Pi package directory');
    const root = absolutePath(env.PI_CODING_AGENT_ROOT);
    await checkPackage(root, SDK_PACKAGE);
    return root;
  }
  let entry;
  try {
    entry = resolve(SDK_PACKAGE);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  }
  // Resolve the import export rather than package.json: Pi does not export its
  // manifest. Walking from the entry also supports npm workspace symlinks.
  let candidate = dirname(fileURLToPath(entry));
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8'));
      if (manifest.name === SDK_PACKAGE) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error('Resolved Pi entry has no matching package manifest');
    candidate = parent;
  }
}

async function checkPackage(root, expected) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== expected) throw new Error(`Expected package ${expected}, found ${manifest.name || '(unnamed)'}`);
}

/** Deliberately let missing internals or dependencies fail, never skip. */
export async function loadPiTestApi(root) {
  const native = file => import(pathToFileURL(join(root, file)).href);
  const sdkRequire = createRequire(join(root, 'package.json'));
  const coreManifest = sdkRequire.resolve('@earendil-works/pi-agent-core/package.json');
  const [{ loadExtensions }, { ExtensionRunner }, { wrapRegisteredTools }, { SessionManager }, { runToolCall }] = await Promise.all([
    native('dist/core/extensions/loader.js'),
    native('dist/core/extensions/runner.js'),
    native('dist/core/extensions/wrapper.js'),
    native('dist/core/session-manager.js'),
    import(pathToFileURL(join(dirname(coreManifest), 'dist/agent-loop.js')).href),
  ]);
  const api = { loadExtensions, ExtensionRunner, wrapRegisteredTools, SessionManager, runToolCall };
  for (const [name, value] of Object.entries(api)) {
    if (typeof value !== 'function') throw new Error(`Installed Pi SDK is incompatible: missing ${name}`);
  }
  return api;
}
