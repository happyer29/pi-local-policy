import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import {
  type ExtensionAPI,
  createBashToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  createEditToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition,
  createCodemodeExtension,
} from '@earendil-works/pi-coding-agent';
import { canonicalPath, projectRoot, pathDecision, commandDecision, toolDecision, containsCredential, SECRET_PATH, loadPolicyConfig } from './policy.mjs';
import { runSandbox } from './sandbox.mjs';
import { fetchPublicPage } from './public-fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWN = fileURLToPath(import.meta.url);
const AGENT = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
const WORKER = join(HERE, 'fs-worker.mjs');
const ENTRY = 'local-policy-settings-v1';
const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const message = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const EXCLUDES = ['!.git/**', '!.pi/**', '!.agents/**', '!**/.env*', '!**/*.pem', '!**/*.key', '!**/auth.json', '!**/secrets*', '!**/credentials*'];
const browserNames = ['browser_goto', 'browser_eval', 'browser_console', 'browser_network', 'browser_fill', 'browser_click', 'browser_screenshot', 'browser_close'];

export default function localPolicy(pi: ExtensionAPI) {
  let savedRoot: string | undefined;
  let extraReads: string[] = [];
  let artifactReads: string[] = [];
  let scratch: string | undefined;
  let controller = new AbortController();
  let error: string | undefined;
  let dialogQueue: Promise<unknown> = Promise.resolve();
  const counts = { automatic: 0, blocked: 0, asked: 0 };
  // A fresh Pi profile may not have downloaded rg yet. Use only conventional
  // trusted install locations; never download or inherit an arbitrary PATH.
  const rgCandidates = [join(AGENT, 'bin', 'rg'), '/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg'];
  const runtimeRoots = [dirname(dirname(process.execPath)), join(AGENT, 'bin')];
  // The built-in codemode also exposes direct classifier/image APIs outside the
  // tool pipeline. Keep batching, but expose only nested checked tools here.
  createCodemodeExtension({ models: false })({ ...pi, registerTool(definition: any) {
    pi.registerTool({ ...definition, name: 'local_codemode', label: 'codemode (local policy)', defaultActive: true,
      async execute(id: string, args: any, signal: any, update: any, ctx: any) {
        const tools = ctx.tools.filter((t: any) => !['codemode','local_codemode'].includes(t.name));
        return definition.execute(id,args,signal,update,{...ctx,tools,executeTool:ctx.executeTool});
      },
    });
  } } as ExtensionAPI);
  let config: any = {};
  let configFile = join(AGENT, 'local-policy.json');
  try {
    const loaded = loadPolicyConfig({ agentDir: AGENT, extensionDir: HERE });
    config = loaded.config; configFile = loaded.file;
  } catch (e: any) { error = `Configuration error: ${e.message}`; }

  function options(ctx: any) {
    if (error) throw new Error(error);
    if (!scratch) scratch = canonicalPath(mkdtempSync(join(tmpdir(), 'pi-local-policy-')));
    const root = projectRoot(savedRoot || ctx.cwd);
    const readRoots = [HERE, join(AGENT, 'skills'), join(AGENT, 'extensions'), join(homedir(), '.agents', 'skills'), ...runtimeRoots, ...(config.readRoots || []), ...extraReads, ...artifactReads]
      .filter(p => existsSync(p)).map(p => canonicalPath(p));
    return { root, cwd: root, scratch, readRoots, runtimeRoots };
  }
  function audit(tool: string, action: string) {
    // Metadata only. The Pi transcript already contains actual tool arguments.
    if (action === 'allow') counts.automatic++;
    else if (action === 'deny') counts.blocked++;
  }
  function verifiedSources() {
    return {
      ownPath: OWN, agentDir: AGENT,
      readSources: { ...(config.askTools?.web_search ? {} : { web_search: join(AGENT, 'extensions', 'web-search', 'index.ts') }), ...(config.readTools || {}) },
      askSources: { ...Object.fromEntries(browserNames.map(n => [n, join(AGENT, 'extensions', 'browser', 'index.ts')])), ...(config.askTools || {}) },
    };
  }
  function joinedSignal(signal?: AbortSignal) { return signal ? AbortSignal.any([signal, controller.signal]) : controller.signal; }
  async function ask(ctx: any, title: string, data: unknown, signal?: AbortSignal) {
    if (!ctx.hasUI || containsCredential(data)) return false;
    const preview = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    if (preview.length > 12000) return false;
    const run = async () => {
      const s = joinedSignal(signal || ctx.signal);
      if (s.aborted) return false;
      counts.asked++;
      return await ctx.ui.confirm(title, preview + '\n\nApproval applies to this invocation only.', { timeout: 120000, signal: s });
    };
    const pending = dialogQueue.then(run, run);
    dialogQueue = pending.catch(() => false);
    return await pending;
  }
  async function fsOp(ctx: any, operation: string, path: string, data?: string, signal?: AbortSignal) {
    const opts = options(ctx);
    const check = pathDecision(path, { ...opts, write: ['write', 'mkdir', 'editAccess'].includes(operation) });
    if (check.action !== 'allow') throw new Error(`Local policy: ${check.reason}`);
    const result = await runSandbox({ ...opts, command: q(process.execPath) + ' ' + q(WORKER), input: JSON.stringify({ operation, path: check.target, data }), signal: joinedSignal(signal || ctx.signal), timeout: 30 });
    if (result.exitCode !== 0 || result.truncated) throw new Error(`Sandboxed ${operation} failed: ${result.output.slice(0, 1500)}`);
    return JSON.parse(result.output).result;
  }
  function fileReadOps(ctx: any, signal?: AbortSignal) {
    let cached: { path: string, data: Buffer } | undefined;
    const readFile = async (path: string) => {
      if (cached?.path === path) return cached.data;
      const value = await fsOp(ctx, 'read', path, undefined, signal);
      const data = Buffer.from(value.base64, 'base64'); cached = { path, data }; return data;
    };
    return {
      readFile,
      access: (path: string) => fsOp(ctx, 'access', path, undefined, signal),
      detectImageMimeType: async (path: string) => {
        const b = await readFile(path);
        if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
        if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
        if (b.subarray(0, 3).toString() === 'GIF') return 'image/gif';
        if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP') return 'image/webp';
        return undefined;
      },
    };
  }
  const readBase = createReadToolDefinition(process.cwd());
  pi.registerTool({ ...readBase, label: 'read', async execute(id, args, signal, update, ctx) {
    const opts = options(ctx);
    return createReadToolDefinition(opts.root, { operations: fileReadOps(ctx, signal) }).execute(id, args, signal, update, { ...ctx, cwd: opts.root });
  } });
  const writeBase = createWriteToolDefinition(process.cwd());
  pi.registerTool({ ...writeBase, async execute(id, args, signal, update, ctx) {
    const opts = options(ctx);
    const operations = { writeFile: (p: string, data: string) => fsOp(ctx, 'write', p, data, signal), mkdir: (p: string) => fsOp(ctx, 'mkdir', p, undefined, signal) };
    return createWriteToolDefinition(opts.root, { operations }).execute(id, args, signal, update, { ...ctx, cwd: opts.root });
  } });
  const editBase = createEditToolDefinition(process.cwd());
  pi.registerTool({ ...editBase, async execute(id, args, signal, update, ctx) {
    const opts = options(ctx);
    const operations = { readFile: fileReadOps(ctx, signal).readFile, writeFile: (p: string, data: string) => fsOp(ctx, 'write', p, data, signal), access: (p: string) => fsOp(ctx, 'editAccess', p, undefined, signal) };
    return createEditToolDefinition(opts.root, { operations }).execute(id, args, signal, update, { ...ctx, cwd: opts.root });
  } });

  async function executeBash(id: string, args: any, signal: AbortSignal | undefined, update: any, ctx: any, network: boolean) {
    const opts = options(ctx);
    const decision = commandDecision(args.command, { network });
    if (decision.action === 'deny') throw new Error(`Local policy: ${decision.reason}`);
    if (network && !(await ask(ctx, 'Allow this command to access the network?', args.command, signal))) throw new Error('External action was not approved; command not executed');
    const operations = { exec: async (command: string, cwd: string, o: any) => {
      const result = await runSandbox({ ...opts, cwd, command, network, onData: o.onData, signal: joinedSignal(o.signal), timeout: o.timeout || 120 });
      return { exitCode: result.exitCode };
    } };
    const tool = createBashToolDefinition(opts.root, { operations, exposeSessionEnvironment: false });
    const result = await tool.execute(id, args, signal, update, { ...ctx, cwd: opts.root });
    const artifact = result.structuredContent?.full_output_path;
    if (typeof artifact === 'string' && existsSync(artifact)) artifactReads.push(canonicalPath(artifact));
    return result;
  }
  const bashBase = createBashToolDefinition(process.cwd());
  pi.registerTool({ ...bashBase, promptGuidelines: ['Commands run locally with project-only writes, no host credentials and no network. Ordinary pipes and tests need no confirmation. Use web_search/web_fetch for research; network_bash asks once for external changes.'], async execute(id, args, signal, update, ctx) { return executeBash(id, args, signal, update, ctx, false); } });
  pi.registerTool({ ...bashBase, name: 'network_bash', label: 'network_bash', description: 'Run one explicitly approved command with network access, keeping the same project filesystem sandbox and scrubbed environment. Asks the human for this invocation only. Host credentials remain unavailable.', promptSnippet: 'Request one-action approval for a network command or publication', async execute(id, args, signal, update, ctx) { return executeBash(id, args, signal, update, ctx, true); } });

  async function search(ctx: any, args: any, signal: AbortSignal | undefined, files: boolean) {
    const opts = options(ctx);
    const check = pathDecision(args.path || '.', opts);
    if (check.action !== 'allow') throw new Error(`Local policy: ${check.reason}`);
    const installedRg = rgCandidates.find(p => existsSync(p));
    if (!installedRg) throw new Error('ripgrep (rg) is required for grep/find. Install it in the Pi profile bin directory or a conventional Homebrew/system bin directory, then /reload. No automatic download was attempted; sandboxed bash can use other available search programs.');
    const rg = canonicalPath(installedRg);
    const commandArgs = files ? ['--files', '--hidden', '--glob', args.pattern] : ['--line-number', '--with-filename', '--color=never', '--hidden', '--max-count', String(Math.min(1000, Math.max(1, args.limit || 100)))];
    for (const exclude of EXCLUDES) commandArgs.push('--glob', exclude);
    if (!files) {
      if (args.ignoreCase) commandArgs.push('--ignore-case');
      if (args.literal) commandArgs.push('--fixed-strings');
      if (args.glob) commandArgs.push('--glob', args.glob);
      if (args.context) commandArgs.push('--context', String(Math.min(50, Math.max(0, args.context))));
      commandArgs.push('--', args.pattern);
    } else commandArgs.push('--');
    commandArgs.push(check.target);
    const result = await runSandbox({ ...opts, command: [rg, ...commandArgs].map(q).join(' '), signal: joinedSignal(signal || ctx.signal), timeout: 30 });
    // rg may report denied secret files; no protected contents can be read.
    if (result.exitCode === 71) throw new Error('OS sandbox could not initialize; search was not executed');
    if (![0, 1].includes(result.exitCode) && !result.output.includes('Permission denied') && !result.output.includes('Operation not permitted')) throw new Error(`Sandboxed search failed: ${result.output.slice(0,1500)}`);
    const max = Math.min(2000, Math.max(1, args.limit || (files ? 1000 : 100)));
    const lines = result.output.split('\n').filter(Boolean).filter(line => !/Permission denied|Operation not permitted/.test(line));
    const text = lines.slice(0, max).join('\n').slice(0, 50000);
    return message((text || '(no matches in permitted files)') + (result.exitCode === 2 ? '\n[Some protected or unreadable paths were skipped; this is not an exhaustive absence claim.]' : '') + (lines.length > max || result.truncated ? '\n[Results truncated]' : ''));
  }
  pi.registerTool({ ...createGrepToolDefinition(process.cwd()), async execute(_id, args, signal, _update, ctx) { return search(ctx, args, signal, false); } });
  pi.registerTool({ ...createFindToolDefinition(process.cwd()), async execute(_id, args, signal, _update, ctx) { return search(ctx, args, signal, true); } });
  pi.registerTool({ ...createLsToolDefinition(process.cwd()), async execute(_id, args, signal, _update, ctx) {
    const opts = options(ctx), path = args.path || '.';
    const entries = await fsOp(ctx, 'readdir', path, undefined, signal);
    const dir = canonicalPath(path, opts.root);
    const visible = entries.filter((e: any) => pathDecision(join(dir,e.name), opts).action === 'allow').sort((a: any,b: any)=>a.name.localeCompare(b.name));
    const max = Math.min(2000, Math.max(1, args.limit || 500));
    return message(visible.slice(0,max).map((e: any)=>e.name+(e.directory?'/':'')).join('\n') || '(empty directory)');
  } });
  pi.registerTool({ name: 'web_fetch', label: 'Web Fetch', description: 'Read a public HTTP(S) page without authentication. Validates DNS and every redirect, refuses private/local addresses and credential URLs. Returns text; no external writes.', promptSnippet: 'Read a public web page for research', parameters: Type.Object({ url: Type.String() }), async execute(_id, args, signal, _update, ctx) {
    const page = await fetchPublicPage(args.url, { signal: joinedSignal(signal || ctx.signal) });
    return { ...message((page.title ? '# ' + page.title + '\n\n' : '') + 'Source: ' + page.url + '\n\n' + page.content), details: { url: page.url } };
  } });

  pi.on('tool_call', async (event, ctx) => {
    try {
    const source = pi.getAllTools().find(t => t.name === event.toolName)?.sourceInfo?.path;
    let decision = error ? { action: 'deny', reason: error } : toolDecision(event.toolName, event.input, source, verifiedSources());
    if (decision.action === 'allow' && ['read','write','edit','grep','find','ls'].includes(event.toolName)) {
      try {
        const opts = options(ctx);
        decision = pathDecision((event.input as any).path || '.', { ...opts, write: ['write','edit'].includes(event.toolName) });
      } catch (e: any) { decision = { action: 'deny', reason: e.message }; }
    }
    if (decision.action === 'allow' && event.toolName === 'bash') decision = commandDecision((event.input as any).command);
    if (event.toolName !== 'network_bash' || decision.action === 'deny') audit(event.toolName, decision.action);
    if (decision.action === 'ask') {
      if (await ask(ctx, `Allow external action: ${event.toolName}?`, event.input)) return;
      return { block: true, reason: 'External action not approved; nothing executed' };
    }
    if (decision.action === 'deny') return { block: true, reason: `Local policy: ${decision.reason}. Do not retry via another tool or executor.` };
    } catch {
      counts.blocked++;
      return { block: true, reason: 'Local policy could not verify this action; nothing executed. No fallback to another executor.' };
    }
  });

  pi.on('session_start', async (_event, ctx) => {
    controller.abort(); controller = new AbortController(); artifactReads = []; savedRoot = undefined; extraReads = [];
    const saved: any = ctx.sessionManager.getBranch().filter((e: any)=>e.type==='custom' && e.customType===ENTRY).at(-1);
    if (saved?.data?.root) savedRoot = saved.data.root;
    if (Array.isArray(saved?.data?.readRoots)) extraReads = saved.data.readRoots;
    pi.setActiveTools([...new Set([...pi.getActiveTools().filter(n=>n!=='codemode'),'local_codemode'])]);
    try {
      const opts = options(ctx);
      const probe = await runSandbox({ ...opts, command: 'printf local-policy-ready', timeout: 5 });
      if (probe.exitCode !== 0 || probe.output !== 'local-policy-ready') throw new Error('OS sandbox could not initialize');
      ctx.ui.setStatus('local-policy', 'Local policy: AUTO · sandbox · no Jev');
    } catch (e: any) { ctx.ui.setStatus('local-policy', 'Local policy: BLOCKED — /local-policy'); ctx.ui.notify(`Local policy: ${e.message}`, 'warning'); }
  });
  pi.on('session_shutdown', () => { controller.abort(); });
  pi.on('before_agent_start', (event, ctx) => {
    pi.setActiveTools([...new Set([...pi.getActiveTools().filter(n=>n!=='codemode'),'local_codemode'])]);
    let root = 'not selected; ask user to run /local-policy root /project';
    try { root = options(ctx).root; } catch {}
    event.systemPromptOptions.sections.local_policy = `Local deterministic policy is active. Project root: ${root}. Ordinary reads, edits and test commands are automatic inside the sandbox. No Jev or LLM approval calls. Use local_codemode for batching nested tools; direct auxiliary model APIs are unavailable there. Bash has no network, host credentials or startup rc files. Read and write only approved paths; protected secrets and agent/Git control files are blocked. Use web_search and web_fetch for public research. network_bash requests one human approval and keeps filesystem restrictions. Unknown tools are blocked. Do not rerun a blocked action through another executor, encoded script, browser or subprocess; report the limitation and continue independent permitted work. User can grant a folder with /local-policy allow-read /path. Relative paths refer to the selected project root.`;
  });
  pi.registerCommand('local-policy', {
    description: 'Local permissions: status | root /project | allow-read /folder (no Jev)',
    async handler(args, ctx) {
      const match = args.trim().match(/^(root|allow-read)\s+(.+)$/s);
      if (match) {
        try {
          const target = canonicalPath(match[2].trim(), ctx.cwd);
          if (SECRET_PATH.test(target)) throw new Error('A credentials folder cannot be granted');
          if (match[1] === 'root') savedRoot = projectRoot(target);
          else { if (!existsSync(target)) throw new Error('Read path must exist'); extraReads = [...new Set([...extraReads,target])]; }
          pi.appendEntry(ENTRY, { root: savedRoot, readRoots: extraReads });
          ctx.ui.notify('Local policy updated for this session and its reloads.', 'info');
        } catch (e: any) { ctx.ui.notify(e.message, 'error'); }
      } else if (args.trim() && args.trim() !== 'status') { ctx.ui.notify('/local-policy status | root /project | allow-read /path', 'info'); return; }
      let root: string; try { root = options(ctx).root; } catch (e: any) { root = e.message; }
      ctx.ui.notify(`Local policy v1\nRoot: ${root}\nConfig: ${configFile}\nOrdinary project reads/writes/tests: automatic\nBash: OS sandbox, no network or inherited secrets\nPublic search/fetch: automatic\nExternal/browser actions: one-call confirmation\nUnknown tools, credentials and outside writes: blocked\nAutomatic: ${counts.automatic}; blocked: ${counts.blocked}; confirmations: ${counts.asked}`, 'info');
    },
  });
}
