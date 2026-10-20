import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildProfile, cleanEnvironment, runSandbox } from '../src/sandbox.mjs';

test('profile is deny-default and keeps explicit restrictions after scoped grants', () => {
  const profile = buildProfile({ root: '/tmp/project', scratch: '/tmp/scratch', readRoots: ['/tmp/skills'], runtimeRoots: ['/tmp/runtime'] });
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /\(deny network\*\)/);
  assert.match(profile, /\(subpath "\/tmp\/project"\)/);
  assert.match(profile, /\(subpath "\/tmp\/skills"\)/);
  assert.match(profile, /\(deny file-read-data/);
  assert.match(profile, /\(deny file-write\*/);
  assert.ok(profile.indexOf('(deny file-read-data') > profile.indexOf('(allow file-read-data'));
  assert.ok(!profile.includes('(allow mach-lookup'));
  assert.ok(!profile.includes('(allow process*)'));
});

test('network must be explicit and strings cannot inject Seatbelt expressions', () => {
  const profile = buildProfile({ root: '/tmp/p"\n(allow default)', scratch: '/tmp/scratch', network: true });
  assert.match(profile, /\(allow network\*\)/);
  assert.ok(profile.includes('/tmp/p\\"\\n(allow default)'));
  assert.throws(() => buildProfile({ root: '/', scratch: '/tmp/scratch' }), /specific/);
  assert.throws(() => buildProfile({ root: os.homedir(), scratch: '/tmp/scratch' }), /specific/);
  assert.throws(() => buildProfile({ root: '/tmp/project', scratch: '/' }), /specific/);
  assert.throws(() => buildProfile({ root: '/tmp/project', scratch: '/tmp/s', readRoots: ['relative'] }), /absolute/);
});

test('environment removes arbitrary secrets and startup/credential controls', () => {
  const env = cleanEnvironment({ scratch: '/tmp/s', runtimeRoots: ['/tmp/node'], env: {
    PATH: '/malicious', HOME: '/realhome', OPENAI_API_KEY: 'secret', RANDOM_SECRET: 'secret', SSH_AUTH_SOCK: '/agent',
    BASH_ENV: '/evil', ENV: '/evil', NODE_OPTIONS: '--import /evil', DYLD_INSERT_LIBRARIES: '/evil',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: 'evil',
    LANG: 'en_US.UTF-8', LC_ALL: 'bad\nvalue', TZ: 'UTC',
  } });
  assert.equal(env.HOME, '/tmp/s/home');
  assert.equal(env.TMPDIR, '/tmp/s/tmp');
  assert.equal(env.LANG, 'en_US.UTF-8');
  assert.equal(env.TZ, 'UTC');
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.ok(env.PATH.includes('/tmp/node/bin'));
  assert.ok(!env.PATH.includes('/malicious'));
  for (const key of ['OPENAI_API_KEY', 'RANDOM_SECRET', 'SSH_AUTH_SOCK', 'BASH_ENV', 'ENV', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'GIT_CONFIG_COUNT', 'LC_ALL']) assert.equal(env[key], undefined);
});

test('invalid arguments and cancellation fail before spawn', async () => {
  await assert.rejects(runSandbox({ command: 'true', root: '/', scratch: '/tmp/s' }), /specific|requires macOS/);
  await assert.rejects(runSandbox({ command: 'true', root: '/tmp/p', scratch: '/tmp/s', timeout: 0 }), /timeout|requires macOS/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runSandbox({ command: 'true', root: '/tmp/p', scratch: '/tmp/s', signal: controller.signal }), /aborted|requires macOS/);
});

test('scratch setup ignores reused attacker paths and refuses a symlink base', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'pi-policy-host-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'); const scratch = path.join(base, 'scratch'); const outside = path.join(base, 'outside');
  await Promise.all([mkdir(root), mkdir(scratch), mkdir(outside)]);
  await symlink(outside, path.join(scratch, 'home'));
  if (process.platform === 'darwin') {
    const result = await runSandbox({ command: 'true', root, scratch });
    assert.equal(path.dirname(result.runDir), await import('node:fs/promises').then(fs => fs.realpath(scratch)));
  }
  await assert.rejects(readFile(path.join(outside, '.cache')), /ENOENT/);
  const alias = path.join(base, 'alias'); await symlink(scratch, alias);
  await assert.rejects(runSandbox({ command: 'true', root, scratch: alias }), /preallocated real|requires macOS/);
});

// Run real OS checks explicitly: PI_POLICY_SANDBOX_TEST=1 node --test tests/sandbox.test.mjs.
// A sandbox that cannot initialize must fail; never silently skip the confinement checks.
test('real sandbox confines shell, children, stdin, network, paths and symlinks', { skip: process.env.PI_POLICY_SANDBOX_TEST !== '1' && 'Set PI_POLICY_SANDBOX_TEST=1 on macOS to run real confinement checks' }, async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'pi-policy-test-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project'); const scratch = path.join(base, 'scratch'); const outside = path.join(base, 'outside');
  await Promise.all([mkdir(root), mkdir(scratch), mkdir(outside)]);
  await writeFile(path.join(root, 'plain.txt'), 'ordinary source');
  await writeFile(path.join(root, '.env'), 'SENTINEL_SECRET');
  await writeFile(path.join(outside, 'private.txt'), 'OUTSIDE_SECRET');
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, '.pi'));
  await symlink(outside, path.join(root, 'escape'));
  const run = command => runSandbox({ command, root, scratch, runtimeRoots: [path.dirname(path.dirname(process.execPath))] });
  assert.equal((await run('cat plain.txt')).output, 'ordinary source');
  assert.equal((await run('printf ok > created.txt')).exitCode, 0);
  assert.equal(await readFile(path.join(root, 'created.txt'), 'utf8'), 'ok');
  await writeFile(path.join(root, 'auth.json'), 'SENTINEL_SECRET');
  await writeFile(path.join(root, 'vault.kdbx'), 'SENTINEL_SECRET');
  for (const command of ['cat .env', 'cat auth.json', 'cat AUTH.json', 'cat vault.kdbx', 'cat escape/private.txt', 'printf x > escape/created.txt', 'printf x > .git/config', 'printf x > .pi/settings.json', 'mkdir .PI', 'printf x > AGENTS.md', 'printf x > agents.md', `cat '${path.join(outside, 'private.txt')}'`, 'rmdir "$HOME/.cache"', 'mv "$HOME" "$HOME.old"']) {
    const result = await run(command); assert.notEqual(result.exitCode, 0, command); assert.ok(!result.output.includes('SENTINEL_SECRET')); assert.ok(!result.output.includes('OUTSIDE_SECRET'));
  }
  const child = await run(`'${process.execPath}' -e "require('node:fs').readFileSync('.env')"`);
  assert.notEqual(child.exitCode, 0);
  const network = await run(`'${process.execPath}' -e "const s=require('node:net').connect(443,'1.1.1.1');s.on('error',()=>process.exit(9));setTimeout(()=>process.exit(0),1000)"`);
  assert.equal(network.exitCode, 9);
  const stdin = await runSandbox({ command: 'cat', root, scratch, input: 'trusted input' });
  assert.equal(stdin.output, 'trusted input');
  const prior = await run('printf prior > "$TMPDIR/prior.txt"; printf %s "$TMPDIR/prior.txt"');
  assert.equal((await run(`cat '${prior.output}'`)).output, 'prior');
  assert.notEqual((await run(`printf tampered > '${prior.output}'`)).exitCode, 0);
  await assert.rejects(runSandbox({ command: 'sleep 5', root, scratch, timeout: 0.05 }), /timed out/);
});
