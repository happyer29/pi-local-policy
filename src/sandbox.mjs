import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const SANDBOX = '/usr/bin/sandbox-exec';
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const FIXED_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/opt/homebrew/bin', '/usr/local/bin'];
// Do not allow all of /System: /System/Volumes/Data aliases user files.
const SYSTEM_READ_ROOTS = ['/System/Library', '/System/DriverKit', '/System/iOSSupport', '/System/Volumes/Preboot', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/libexec', '/usr/share', '/bin', '/sbin', '/Library/Apple', '/Library/Developer', '/Library/Frameworks', '/opt/homebrew/bin', '/opt/homebrew/sbin', '/opt/homebrew/lib', '/opt/homebrew/libexec', '/opt/homebrew/share', '/opt/homebrew/Cellar', '/opt/homebrew/opt', '/usr/local/bin', '/usr/local/sbin', '/usr/local/lib', '/usr/local/libexec', '/usr/local/share', '/usr/local/Cellar', '/usr/local/opt'];
// These are path filters, not content inspection: credentials copied into an
// ordinary source file are ordinary project data and cannot be inferred here.
const SECRET_PATTERNS = [
  '/[.]env([.][^/]*)?(/|$)',
  '/[.](ssh|aws|gnupg|azure|kube|docker)(/|$)',
  '/[.]config/(gcloud|gh|op|1Password)(/|$)',
  '/[.]docker/(config[.]json|contexts)(/|$)',
  '/[.](git-credentials|netrc|npmrc|pypirc|dockercfg)$',
  '/([Ss][Ee][Cc][Rr][Ee][Tt][Ss]?|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll][Ss]?|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][Ss]?)([.][^/]*)?(/|$)',
  '/[Aa][Uu][Tt][Hh][.][Jj][Ss][Oo][Nn](/|$)',
  '/(id_rsa|id_dsa|id_ecdsa|id_ed25519)([.][^/]*)?$',
  '/[^/]*[.]([Pp][Ee][Mm]|[Kk][Ee][Yy]|[Pp]12|[Pp][Ff][Xx]|[Kk][Ee][Yy][Ss][Tt][Oo][Rr][Ee]|[Kk][Dd][Bb][Xx]|[Kk][Ee][Yy][Cc][Hh][Aa][Ii][Nn](-db)?)$',
  '/Library/Keychains(/|$)',
  '/[.]pi/agent/(auth[.]json|sessions|cache)(/|$)',
];
const CONTROL_WRITE_PATTERNS = ['/[.]git(/|$)', '/[.]pi(/|$)', '/[.]agents(/|$)', '/(AGENTS([.]override)?[.]md|CLAUDE[.]md|SYSTEM[.]md|APPEND_SYSTEM[.]md)$'];
const SCRATCH_STRUCTURE = ['', 'home', 'tmp', 'home/.cache', 'home/.config', 'home/.local', 'home/.local/share', 'home/.npm'];

function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error(`${label} must be an absolute path`);
  return path.resolve(value);
}
function safeScope(value, label) {
  const resolved = absolute(value, label);
  if (resolved === '/' || resolved === path.resolve(homedir())) throw new Error(`${label} must be a specific project/scratch folder, not / or the user home`);
  return resolved;
}
const quote = value => JSON.stringify(value);
const unique = values => [...new Set(values)];
const subpathRules = values => values.map(value => `(subpath ${quote(value)})`).join(' ');
function insensitive(pattern) {
  let inClass = false;
  return [...pattern].map(char => {
    if (char === '[') { inClass = true; return char; }
    if (char === ']') { inClass = false; return char; }
    return !inClass && /^[a-z]$/i.test(char) ? `[${char.toUpperCase()}${char.toLowerCase()}]` : char;
  }).join('');
}

/** Compile a deny-default macOS Seatbelt profile. Inputs must be trusted roots. */
export function buildProfile({ root, scratch, readRoots = [], runtimeRoots = [], network = false }) {
  root = safeScope(root, 'root');
  scratch = safeScope(scratch, 'scratch');
  const extraReads = readRoots.map(value => absolute(value, 'readRoots entry'));
  const runtime = runtimeRoots.map(value => absolute(value, 'runtimeRoots entry'));
  const readPaths = unique([...SYSTEM_READ_ROOTS, path.dirname(process.execPath), root, scratch, ...extraReads, ...runtime]);
  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow file-read-metadata)',
    // dyld opens the filesystem root while resolving its shared cache.
    '(allow file-read-data (literal "/"))',
    `(allow file-read-data ${subpathRules(readPaths)})`,
    `(allow file-write* ${subpathRules([root, scratch])})`,
    '(allow file-read-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom") (literal "/private/etc/localtime") (literal "/private/etc/hosts") (literal "/private/etc/resolv.conf") (subpath "/private/var/db/timezone"))',
    '(allow file-write-data (literal "/dev/null"))',
    // No broad Mach IPC permission: launch services/Apple Events could execute
    // actions in an unsandboxed process. DNS/HTTP only work with explicit network.
    network ? '(allow network*)' : '(deny network*)',
    `(deny file-read-data ${SECRET_PATTERNS.map(value => `(regex ${quote(insensitive(value))})`).join(' ')})`,
    `(deny file-write* ${[...SECRET_PATTERNS, ...CONTROL_WRITE_PATTERNS].map(value => `(regex ${quote(insensitive(value))})`).join(' ')})`,
    // The host prepares this skeleton. Sandbox children may write within it,
    // but cannot replace any ancestor with a symlink before the next invocation.
    `(deny file-write* ${SCRATCH_STRUCTURE.map(value => `(literal ${quote(path.join(scratch, value))})`).join(' ')})`,
  ];
  return `${lines.join('\n')}\n`;
}

/** No caller-supplied PATH, shell init, Git credentials, tokens, or agent socket. */
export function cleanEnvironment({ scratch, env = process.env, runtimeRoots = [] }) {
  scratch = safeScope(scratch, 'scratch');
  const home = path.join(scratch, 'home');
  const runtimePaths = runtimeRoots.map(value => absolute(value, 'runtimeRoots entry')).flatMap(value => [path.join(value, 'bin'), value]);
  const cleaned = {
    PATH: unique([path.dirname(process.execPath), ...runtimePaths, ...FIXED_PATH]).join(path.delimiter),
    HOME: home,
    TMPDIR: path.join(scratch, 'tmp'),
    TMP: path.join(scratch, 'tmp'),
    TEMP: path.join(scratch, 'tmp'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    npm_config_cache: path.join(home, '.npm'),
    npm_config_userconfig: '/dev/null',
    npm_config_globalconfig: '/dev/null',
    npm_config_offline: 'true',
    npm_config_update_notifier: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    PYTHONNOUSERSITE: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_ASKPASS: '/usr/bin/false',
    SSH_ASKPASS: '/usr/bin/false',
    CI: '1',
    NO_COLOR: '1',
  };
  // Preserve locale only after validation; shell-related values are never copied.
  for (const key of ['LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']) {
    const value = env[key];
    if (typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_./+@:-]+$/.test(value)) cleaned[key] = value;
  }
  cleaned.LANG ??= 'en_US.UTF-8';
  return cleaned;
}

/**
 * Run a command in Seatbelt. There is deliberately no unsandboxed fallback.
 * Returns {exitCode, output, truncated, runDir, scratchDir, signal?}.
 * scratch is a preallocated trusted base OUTSIDE root. Each call gets a fresh
 * writable child; the base/prior children are only readable in the sandbox.
 * onData receives Buffer chunks.
 * timeout is in seconds. input optionally pipes trusted worker input to stdin.
 */
export async function runSandbox({ command, cwd, root, scratch, readRoots = [], runtimeRoots = [], network = false, onData, signal, timeout = 120, input }) {
  if (process.platform !== 'darwin') throw new Error('Local policy sandbox requires macOS sandbox-exec; command was not run');
  if (typeof command !== 'string' || command.includes('\0')) throw new Error('command must be a string without NUL');
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) throw new Error('timeout must be in seconds, from greater than 0 through 3600');
  if (signal?.aborted) throw new Error('Sandbox command aborted before execution');
  root = safeScope(await realpath(safeScope(root, 'root')), 'root');
  cwd = await realpath(absolute(cwd ?? root, 'cwd'));
  if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) throw new Error('Sandbox cwd must stay inside project root');
  scratch = safeScope(scratch, 'scratch');
  const scratchStat = await lstat(scratch);
  if (scratchStat.isSymbolicLink() || !scratchStat.isDirectory()) throw new Error('Scratch must be a preallocated real directory, not a symlink');
  scratch = await realpath(scratch);
  safeScope(scratch, 'scratch');
  if (scratch === root || scratch.startsWith(`${root}${path.sep}`) || root.startsWith(`${scratch}${path.sep}`)) throw new Error('Scratch base and project root must be separate, non-overlapping directories');
  const scratchBase = scratch;
  // mkdtemp is atomic. Previous sandbox children only had read access to this
  // parent and cannot replace the new run or its HOME with a symlink.
  scratch = await mkdtemp(path.join(scratchBase, 'run-'));
  for (const dir of SCRATCH_STRUCTURE.slice(1)) {
    const target = path.join(scratch, dir);
    // No recursive mkdir and no reused sandbox-writable paths.
    await mkdir(target, { mode: 0o700 });
    const stats = await lstat(target);
    if (stats.isSymbolicLink() || !stats.isDirectory() || await realpath(target) !== target) throw new Error(`Unsafe scratch structure: ${dir} must be a real directory`);
  }
  const profile = buildProfile({ root, scratch, readRoots: [...readRoots, scratchBase], runtimeRoots, network });
  const env = cleanEnvironment({ scratch, runtimeRoots });
  if (network) env.npm_config_offline = 'false';
  return new Promise((resolve, reject) => {
    const child = spawn(SANDBOX, ['-p', profile, '/bin/bash', '--noprofile', '--norc', '-c', command], {
      cwd, env, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    let outputBytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let callbackError;
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
    };
    const onAbort = () => { aborted = true; kill(); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout * 1000);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    function accept(data) {
      const remaining = MAX_OUTPUT_BYTES - outputBytes;
      if (outputBytes < MAX_OUTPUT_BYTES) {
        const kept = data.subarray(0, remaining);
        chunks.push(kept);
        outputBytes += kept.length;
      }
      if (data.length > remaining) truncated = true;
      if (onData && !callbackError) {
        try { onData(data); } catch (error) { callbackError = error; kill(); }
      }
    }
    child.stdout.on('data', accept);
    child.stderr.on('data', accept);
    child.stdin?.on('error', () => {}); // Early sandbox rejection may close stdin.
    if (input !== undefined) child.stdin.end(input);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    child.on('error', error => { cleanup(); reject(new Error(`Could not start sandbox; command was not run: ${error.message}`)); });
    child.on('close', (code, exitSignal) => {
      cleanup();
      if (callbackError) return reject(callbackError);
      if (timedOut) return reject(new Error(`Sandbox command timed out after ${timeout} seconds`));
      if (aborted) return reject(new Error('Sandbox command aborted'));
      let output = Buffer.concat(chunks).toString('utf8');
      let exitCode = code ?? (exitSignal === 'SIGKILL' ? 137 : 1);
      if (/sandbox-exec: (?:sandbox_apply|.*(?:profile|syntax|parse))/.test(output)) {
        exitCode = 71;
        output = `Local policy sandbox could not initialize; command was not run. No unsandboxed fallback is allowed.\n${output}`;
      }
      resolve({ exitCode, output, truncated, runDir: scratch, scratchDir: scratch, ...(exitSignal ? { signal: exitSignal } : {}) });
    });
  });
}
