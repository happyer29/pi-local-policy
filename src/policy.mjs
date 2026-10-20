import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, join, basename, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

export const VERSION = 1;
export const FILE_TOOLS = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls']);
export const LOCAL_TOOLS = new Set([...FILE_TOOLS, 'bash', 'network_bash', 'web_fetch', 'local_codemode']);
export const SECRET_PATH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.docker|\.config\/gcloud|\.npmrc|\.netrc|\.git-credentials|\.pypirc|auth\.json|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|passwords?(?:\.[^/]*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.[^/]*)?)(?:\/|$)|\.(?:pem|key|p12|pfx|keystore|kdbx)$/i;
export const CONTROL_PATH = /(?:^|\/)(?:\.git|\.pi|\.agents)(?:\/|$)|(?:^|\/)(?:AGENTS(?:\.override)?\.md|CLAUDE\.md|SYSTEM\.md|APPEND_SYSTEM\.md)$/i;
const SECRET_VALUE = /-----BEGIN [^-]*PRIVATE KEY-----|\bsk-(?:or-v1-)?[A-Za-z0-9_-]{16,}|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|\bBearer\s+[A-Za-z0-9_.-]{8,}/i;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function absoluteConfigPath(value) {
  return typeof value === 'string' && value.trim() === value && isAbsolute(value) && !value.includes('\0');
}

export function validatePolicyConfig(value) {
  if (!record(value)) throw new Error('Expected a configuration object');
  const allowed = new Set(['version', 'readRoots', 'readTools', 'askTools']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Unknown configuration field');
  if (Object.hasOwn(value, 'version') && value.version !== VERSION) throw new Error('Unsupported local-policy config version');
  if (Object.hasOwn(value, 'readRoots') && (!Array.isArray(value.readRoots) || !value.readRoots.every(absoluteConfigPath))) throw new Error('readRoots must be an array of absolute paths');
  for (const field of ['readTools', 'askTools']) {
    if (!Object.hasOwn(value, field)) continue;
    if (!record(value[field]) || !Object.entries(value[field]).every(([name, path]) => /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/.test(name) && absoluteConfigPath(path))) throw new Error(`${field} must map tool names to exact absolute source paths`);
  }
  // Automatic host tool execution is deliberately limited to a reviewed search
  // integration. An explicit source grant trusts that extension's own code; it
  // does not move the handler inside our subprocess sandbox.
  if (value.readTools && Object.keys(value.readTools).some(name => name !== 'web_search')) throw new Error('readTools supports only web_search; use askTools for other trusted external tools');
  if (Object.keys(value.readTools || {}).some(name => Object.hasOwn(value.askTools || {}, name))) throw new Error('A tool cannot appear in both readTools and askTools');
  return { version: VERSION, readRoots: [...(value.readRoots || [])], readTools: { ...(value.readTools || {}) }, askTools: { ...(value.askTools || {}) } };
}

export function loadPolicyConfig({ agentDir, extensionDir }) {
  const persistent = join(agentDir, 'local-policy.json');
  const file = existsSync(persistent) ? persistent : join(extensionDir, 'config.json');
  let parsed = {};
  if (existsSync(file)) {
    let source;
    try { source = readFileSync(file, 'utf8'); }
    catch { throw new Error(`Cannot read local-policy configuration: ${file}`); }
    try { parsed = JSON.parse(source); }
    catch { throw new Error(`Invalid JSON in local-policy configuration: ${file}`); }
  }
  // Invalid persistent configuration never falls back to package defaults.
  return { file, config: validatePolicyConfig(parsed) };
}

export function canonicalPath(value, cwd = process.cwd()) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('Invalid path');
  const expanded = value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  let cursor = resolve(cwd, expanded);
  const tail = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error('Path has no existing ancestor');
    tail.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(realpathSync(cursor), ...tail);
}

export function inside(path, root) { return path === root || path.startsWith(root + sep); }

export function projectRoot(value) {
  const root = canonicalPath(value);
  const home = canonicalPath(homedir());
  const broad = ['/', '/Users', '/private', '/private/tmp', '/tmp', home, ...['Documents', 'Downloads', 'Desktop'].map(p => join(home, p))];
  if (broad.some(p => canonicalPath(p) === root)) throw new Error('Choose a project folder, not the filesystem, home or general Documents/Desktop folder. Use /local-policy root /absolute/project.');
  const systemRoots = ['/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/opt', '/private/etc', '/private/var/db', '/private/var/root', '/private/var/run', '/private/var/log'];
  if (systemRoots.some(p => inside(root, canonicalPath(p)))) throw new Error('A system or shared toolchain directory cannot be a writable project.');
  if (SECRET_PATH.test(root) || CONTROL_PATH.test(root)) throw new Error('A credentials, agent configuration or Git directory cannot be a writable project.');
  if (!statSync(root).isDirectory()) throw new Error('Project root must be an existing directory');
  return root;
}

export function pathDecision(value, { root, scratch, readRoots = [], write = false, cwd = root }) {
  let target;
  try { target = canonicalPath(value, cwd); } catch { return { action: 'deny', reason: 'Invalid or inaccessible path' }; }
  const lexical = resolve(cwd, value.startsWith('~/') ? join(homedir(), value.slice(2)) : value);
  if (SECRET_PATH.test(target) || SECRET_PATH.test(lexical)) return { action: 'deny', reason: 'Credential/private path is blocked', target };
  if (write && (CONTROL_PATH.test(target) || CONTROL_PATH.test(lexical))) return { action: 'deny', reason: 'Agent instructions, policy and Git internals are protected from writes', target };
  const roots = write ? [root, scratch] : [root, scratch, ...readRoots];
  if (!roots.some(p => p && inside(target, canonicalPath(p)))) return { action: 'deny', reason: write ? 'Writing outside the project/scratch is blocked' : 'Reading outside approved roots is blocked; the user can add a folder with /local-policy allow-read /path', target };
  return { action: 'allow', target };
}

export function commandDecision(command, { network = false } = {}) {
  if (typeof command !== 'string' || !command.trim() || command.length > 128000 || command.includes('\0')) return { action: 'deny', reason: 'Invalid or oversized command' };
  if (SECRET_VALUE.test(command)) return { action: 'deny', reason: 'A credential appears in the command; it will not be executed or displayed' };
  if (/(?:^|[\s;&|()])(?:sudo|doas|su|osascript|launchctl|diskutil|hdiutil|mkfs\S*|newfs\S*|wipefs|fdisk|gpt|mount|umount|reboot|shutdown|poweroff|halt)(?:[\s;&|()]|$)/i.test(command)) return { action: 'deny', reason: 'System/privilege operations are blocked' };
  if (/\bgit\s+(?:[^\n;&|]*\s)?(?:reset\s+--hard|clean\s+[^\n;&|]*-[a-z]*f|push\s+[^\n;&|]*(?:--force|\s-f\b))/i.test(command)) return { action: 'deny', reason: 'Destructive Git operation is blocked' };
  if (!network && /\bgit\s+push\b|\b(?:npm|pnpm|yarn)\s+publish\b|\b(?:gh|glab)\s+(?:pr|release|issue)\s+(?:create|merge|edit|close|comment)|\b(?:vercel|netlify|firebase)\s+(?:deploy|publish)\b/i.test(command)) return { action: 'deny', reason: 'Publication/external changes require network_bash and one-action human approval' };
  return { action: network ? 'ask' : 'allow' };
}

export function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return false;
  if (/^\[|:/.test(host) || /^\d+(?:\.\d+){3}$/.test(host)) return false;
  if (SECRET_VALUE.test(value) || /[?&](?:token|key|api_key|access_token|password|signature|x-amz-signature)=/i.test(value)) return false;
  return true;
}

export function containsCredential(value) {
  const seen = new Set();
  function check(v) {
    if (typeof v === 'string') return SECRET_VALUE.test(v);
    if (!v || typeof v !== 'object' || seen.has(v)) return false;
    seen.add(v);
    return Object.entries(v).some(([k, item]) => /^(?:password|passphrase|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization|cookie)$/i.test(k) || check(item));
  }
  return check(value);
}

export function toolDecision(name, input, source, { ownPath, agentDir, readSources = {}, askSources = {} }) {
  if (LOCAL_TOOLS.has(name)) return source === ownPath ? { action: 'allow' } : { action: 'deny', reason: 'Expected sandboxed tool override is absent; refusing host execution' };
  if (name === 'codemode') return { action: 'deny', reason: 'Use local_codemode: nested tools are checked and direct auxiliary model APIs are disabled' };
  if (['ask_user_question', 'quiz'].includes(name) && source === `builtin:${name}`) return { action: 'allow' };
  if (containsCredential(input)) return { action: 'deny', reason: 'Credential-bearing tool arguments are blocked' };
  if (name === 'web_search' && typeof source === 'string' && source === readSources.web_search) return { action: 'allow' };
  if (name === 'web_fetch' && typeof source === 'string' && source === readSources.web_fetch) return publicUrl(input?.url) ? { action: 'allow' } : { action: 'deny', reason: 'Only public HTTP(S) URLs without credentials are allowed' };
  if (source && source === askSources[name]) return { action: 'ask', reason: 'External/browser action requires one-invocation approval' };
  return { action: 'deny', reason: `Unknown tool ${name} is blocked by local policy; configure an explicit rule first` };
}
