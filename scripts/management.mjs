import { readFileSync, writeFileSync, existsSync, lstatSync, mkdirSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

export const SOURCE = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src');
export const RUNTIME = ['index.ts', 'policy.mjs', 'sandbox.mjs', 'fs-worker.mjs', 'public-fetch.mjs'];
const STATE = '.managed-install.json';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(value).digest('hex');

export function argumentsFor(argv, action) {
  let apply = false, agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true, action };
    if (arg === '--apply') apply = true;
    else if (arg === '--agent-dir') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--agent-dir requires an absolute path');
      agentDir = argv[++i];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!isAbsolute(agentDir)) throw new Error('Agent directory must be an absolute path');
  return { apply, agentDir: resolve(agentDir), action };
}

export function help(action) {
  return `Usage: node scripts/${action}.mjs [--agent-dir /absolute/pi/agent] [--apply]\n\nDefault: preview only; no files are changed.\n--apply: ${action === 'install' ? 'back up settings and install the reviewed runtime' : 'archive this managed installation and update its settings'}.\nDefault agent directory: PI_CODING_AGENT_DIR or ~/.pi/agent.\nNo downloads, model calls, Git operations or publishing. macOS runtime only.`;
}

function rejectSymlink(path) {
  // Reject symlinks in existing ancestors as well as the final destination.
  // The path is not a boundary against another concurrently running host app.
  let current = resolve(path);
  while (true) {
    let info;
    try { info = lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info?.isSymbolicLink()) throw new Error(`Refusing symlink: ${current}`);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function context(agentDir) {
  rejectSymlink(agentDir);
  const target = join(agentDir, 'extensions', 'local-policy');
  rejectSymlink(target);
  if (existsSync(target) && !lstatSync(target).isDirectory()) throw new Error('Extension destination must be a directory');
  const settingsPath = join(agentDir, 'settings.json');
  rejectSymlink(settingsPath);
  const existed = existsSync(settingsPath);
  const original = existed ? readFileSync(settingsPath, 'utf8') : undefined;
  const settings = existed ? JSON.parse(original) : {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings.json must contain an object');
  for (const name of ['extensions', 'defaultTools']) {
    if (settings[name] !== undefined && (!Array.isArray(settings[name]) || !settings[name].every(s => typeof s === 'string'))) throw new Error(`Unexpected ${name} format; no changes made`);
  }
  return { agentDir, target, settingsPath, existed, original, settings };
}

function newBackup(ctx, action) {
  const parent = join(ctx.agentDir, 'backups');
  rejectSymlink(parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const backup = join(parent, `local-policy-${action}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  mkdirSync(backup, { mode: 0o700 });
  if (ctx.existed) writeFileSync(join(backup, 'settings.json'), ctx.original, { mode: 0o600 });
  return backup;
}

function verifySettingsUnchanged(ctx) {
  if (existsSync(ctx.settingsPath) !== ctx.existed || (ctx.existed && readFileSync(ctx.settingsPath, 'utf8') !== ctx.original)) throw new Error('Settings changed during this operation; refusing to overwrite them');
}

function writeSettings(ctx, next) {
  verifySettingsUnchanged(ctx);
  const temp = join(ctx.agentDir, `.local-policy-settings-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: ctx.existed ? lstatSync(ctx.settingsPath).mode & 0o777 : 0o600, flag: 'wx' });
    renameSync(temp, ctx.settingsPath);
  } finally { rmSync(temp, { force: true }); }
}

function requireMacOS() {
  if (process.platform !== 'darwin') throw new Error('Installation is supported on macOS only; preview and portable tests can run elsewhere');
}

export function install({ agentDir, apply = false }) {
  const ctx = context(agentDir);
  if (resolve(SOURCE) === ctx.target) throw new Error('Run the installer from the repository, not the managed installation');
  if (existsSync(join(ctx.target, STATE))) throw new Error('A managed installation already exists. Uninstall it before reinstalling; its config will be archived');
  for (const name of RUNTIME) {
    const path = join(SOURCE, name);
    if (!lstatSync(path).isFile()) throw new Error(`Runtime file is missing or not a regular file: ${name}`);
  }
  const configPath = join(ctx.target, 'config.json');
  rejectSymlink(configPath);
  if (existsSync(configPath)) JSON.parse(readFileSync(configPath, 'utf8'));
  const entry = join(ctx.target, 'index.ts');
  const conflicts = ['bash-guard', 'web-fetch'].map(name => join(agentDir, 'extensions', name, 'index.ts'));
  const next = { ...ctx.settings };
  next.extensions = (ctx.settings.extensions || []).filter(p => p !== entry && p !== '-' + entry && !conflicts.includes(p));
  for (const path of conflicts) if (!next.extensions.includes('-' + path)) next.extensions.push('-' + path);
  next.extensions.push(entry);
  if (ctx.settings.defaultTools) next.defaultTools = [...new Set(ctx.settings.defaultTools.map(name => name === '+codemode' ? '+local_codemode' : name === 'codemode' ? 'local_codemode' : name))];
  const plan = {
    action: apply ? 'install' : 'preview', agentDir, target: ctx.target,
    runtimeFiles: [...RUNTIME, 'config.json'], preserveExistingConfig: existsSync(configPath),
    settingsChanges: { extensions: next.extensions, defaultTools: next.defaultTools },
    note: 'Disable other approval and conflicting tool extensions yourself. Their settings are preserved. Reload Pi after installation.',
  };
  if (!apply) return plan;
  requireMacOS();
  const backup = newBackup(ctx, 'install');
  mkdirSync(dirname(ctx.target), { recursive: true, mode: 0o700 });
  const stage = join(dirname(ctx.target), `.local-policy-stage-${randomUUID()}`);
  mkdirSync(stage, { mode: 0o700 });
  const hadTarget = existsSync(ctx.target);
  let activated = false;
  try {
    for (const name of RUNTIME) copyFileSync(join(SOURCE, name), join(stage, name));
    copyFileSync(existsSync(configPath) ? configPath : join(SOURCE, 'config.json'), join(stage, 'config.json'));
    const state = {
      version: 1, target: ctx.target, installedAt: new Date().toISOString(), backup, hadTarget,
      before: Object.fromEntries(['extensions', 'defaultTools'].map(name => [name, { present: Object.hasOwn(ctx.settings, name), value: ctx.settings[name] ?? null }])),
      after: Object.fromEntries(['extensions', 'defaultTools'].map(name => [name, { present: Object.hasOwn(next, name), value: next[name] ?? null }])),
      hashes: Object.fromEntries([...RUNTIME, 'config.json'].map(name => [name, hash(readFileSync(join(stage, name)))])),
    };
    writeFileSync(join(stage, STATE), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ action: 'install', target: ctx.target, installedAt: state.installedAt, previousSettingsExisted: ctx.existed, hashes: state.hashes }, null, 2) + '\n', { mode: 0o600 });
    verifySettingsUnchanged(ctx);
    if (hadTarget) renameSync(ctx.target, join(backup, 'previous-extension'));
    renameSync(stage, ctx.target);
    activated = true;
    writeSettings(ctx, next);
    return { ...plan, backup, reloadRequired: true };
  } catch (error) {
    if (activated) rmSync(ctx.target, { recursive: true, force: true });
    if (hadTarget && existsSync(join(backup, 'previous-extension'))) renameSync(join(backup, 'previous-extension'), ctx.target);
    throw error;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

export function uninstall({ agentDir, apply = false }) {
  const ctx = context(agentDir);
  const statePath = join(ctx.target, STATE);
  rejectSymlink(statePath);
  if (!existsSync(statePath)) throw new Error('No managed installation found. This uninstaller does not remove unmanaged extensions');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (state.version !== 1 || state.target !== ctx.target || !state.before || !state.after) throw new Error('Invalid installation manifest; no changes made');
  for (const name of ['extensions', 'defaultTools']) {
    for (const group of [state.before, state.after]) {
      const field = group[name];
      if (!field || typeof field.present !== 'boolean' || (field.present && (!Array.isArray(field.value) || !field.value.every(s => typeof s === 'string')))) throw new Error('Invalid settings history in installation manifest');
    }
  }
  let previous;
  if (state.hadTarget) {
    if (typeof state.backup !== 'string' || dirname(state.backup) !== join(agentDir, 'backups') || !state.backup.startsWith(join(agentDir, 'backups', 'local-policy-install-'))) throw new Error('Invalid previous-extension backup path');
    previous = join(state.backup, 'previous-extension');
    rejectSymlink(previous);
    if (!existsSync(previous) || !lstatSync(previous).isDirectory()) throw new Error('Previous extension backup is missing; restore it before uninstalling');
  }
  const next = { ...ctx.settings }, warnings = [];
  for (const name of ['extensions', 'defaultTools']) {
    const current = { present: Object.hasOwn(ctx.settings, name), value: ctx.settings[name] ?? null };
    if (same(current, state.after[name])) {
      if (state.before[name].present) next[name] = state.before[name].value;
      else delete next[name];
    } else {
      warnings.push(`${name} changed since installation: only local-policy references will be removed; review other entries yourself`);
      if (Array.isArray(next[name])) next[name] = next[name].filter(value => name === 'extensions' ? value !== join(ctx.target, 'index.ts') && value !== '-' + join(ctx.target, 'index.ts') : !['local_codemode', '+local_codemode', '-local_codemode'].includes(value));
    }
  }
  const plan = { action: apply ? 'uninstall' : 'preview', target: ctx.target, restorePreviousExtension: Boolean(previous), settingsChanges: { extensions: next.extensions, defaultTools: next.defaultTools }, warnings, note: 'The removed runtime and config are archived, not destroyed. A replaced previous extension is restored. Other extensions and old backups are retained. Reload Pi.' };
  if (!apply) return plan;
  requireMacOS();
  const backup = newBackup(ctx, 'uninstall');
  writeFileSync(join(backup, 'manifest.json'), JSON.stringify({ action: 'uninstall', target: ctx.target, removedAt: new Date().toISOString(), warnings }, null, 2) + '\n', { mode: 0o600 });
  verifySettingsUnchanged(ctx);
  renameSync(ctx.target, join(backup, 'removed-extension'));
  try {
    if (previous) renameSync(previous, ctx.target);
    writeSettings(ctx, next);
  } catch (error) {
    if (previous && existsSync(ctx.target)) renameSync(ctx.target, previous);
    renameSync(join(backup, 'removed-extension'), ctx.target);
    throw error;
  }
  return { ...plan, backup, reloadRequired: true };
}
