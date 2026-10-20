import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createPublicFetcher, isPublicAddress } from '../src/public-fetch.mjs';

const PUBLIC_V4 = { address: '93.184.216.34', family: 4 };
const PUBLIC_V6 = { address: '2606:4700:4700::1111', family: 6 };

function fixture(routes = {}, resolve = async () => [PUBLIC_V4]) {
  const calls = []; const lookups = []; const destroyed = [];
  const fetch = createPublicFetcher({
    lookup: async (host, opts) => { lookups.push([host, opts]); return resolve(host, opts); },
    request: (url, options, callback) => {
      calls.push({ url: url.href, options });
      const req = new EventEmitter();
      req.destroy = error => { destroyed.push(url.href); if (error) queueMicrotask(() => req.emit('error', error)); };
      req.end = () => queueMicrotask(() => {
        const route = routes[url.href] ?? { type: 'text/plain', body: 'Hello' };
        if (route.pending) return;
        const res = new EventEmitter();
        res.statusCode = route.status ?? 200;
        res.headers = { 'content-type': route.type ?? 'text/plain', ...(route.headers ?? {}) };
        res.destroy = () => { destroyed.push(`response:${url.href}`); };
        callback(res);
        if (route.error) { res.emit('error', route.error); return; }
        for (const chunk of route.chunks ?? [Buffer.from(route.body ?? '')]) res.emit('data', chunk);
        res.emit('end');
      });
      return req;
    },
  });
  return { fetch, calls, lookups, destroyed };
}

test('public-unicast classification denies private, mapped and reserved forms', () => {
  for (const address of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicAddress(address), true, address);
  for (const address of ['garbage', '0.0.0.0', '10.1.2.3', '100.64.1.1', '100.127.255.255', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:8.8.8.8', '64:ff9b::7f00:1', 'fc00::1', 'fe80::1', 'fe80::1%en0', 'ff02::1', '2001::1', '2001:2::1', '2001:db8::1', '2002:7f00:1::', '3fff::1']) assert.equal(isPublicAddress(address), false, address);
});

test('fetches text via GET with pinned DNS, no ambient auth, cookies or pooled agent', async () => {
  const { fetch, calls, lookups } = fixture();
  const result = await fetch('https://public.example.org/page?q=hello#heading');
  assert.deepEqual(result, { url: 'https://public.example.org/page?q=hello', content: 'Hello' });
  assert.equal(lookups.length, 1);
  assert.deepEqual(lookups[0], ['public.example.org', { all: true, verbatim: true }]);
  const opts = calls[0].options;
  assert.equal(opts.method, 'GET'); assert.equal(opts.agent, false); assert.equal(opts.autoSelectFamily, false);
  assert.equal(opts.headers.Authorization, undefined); assert.equal(opts.headers.Cookie, undefined);
  assert.equal(opts.headers['Accept-Encoding'], 'identity');
  opts.lookup('public.example.org', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, PUBLIC_V4.address); assert.equal(family, 4); });
  opts.lookup('public.example.org', { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [PUBLIC_V4]); });
});

test('rejects URL credentials, tokens, private literals and internal hosts before request', async () => {
  const { fetch, calls } = fixture();
  for (const url of [
    'file:///etc/passwd', 'https://user:password@public.example.org/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://localhost/', 'http://host.local/',
    'http://metadata.google.internal/', 'http://host/', 'https://public.example.org:444/',
    'https://public.example.org/?api_key=secret', 'https://public.example.org/?X-Api-Key=secret',
    'https://public.example.org/?options%5Btoken%5D=secret', 'https://public.example.org/#access_token=secret',
    'https://public.example.org/?X-Amz-Signature=secret', 'https://public.example.org/sk-abcdefghijklmnop',
    'https://public.example.org/?v=eyJhbGciOiJIUzI1NiJ9.abcdef.abcdef',
  ]) await assert.rejects(fetch(url), undefined, url);
  assert.equal(calls.length, 0);
});

test('refuses mixed DNS answers and malformed addresses without connecting', async () => {
  for (const addresses of [[PUBLIC_V4, { address: '10.0.0.1', family: 4 }], [PUBLIC_V4, { address: '::ffff:a00:1', family: 6 }], [], [{ address: PUBLIC_V4.address, family: 6 }]]) {
    const { fetch, calls } = fixture({}, async () => addresses);
    await assert.rejects(fetch('https://public.example.org/'), /private|reserved|invalid/);
    assert.equal(calls.length, 0);
  }
});

test('IPv6 public addresses remain pinned and literals need no DNS', async () => {
  const { fetch, calls, lookups } = fixture({}, async () => [PUBLIC_V6]);
  await fetch('https://[2606:4700:4700::1111]/');
  assert.equal(lookups.length, 0); assert.equal(calls[0].options.family, 6);
  calls[0].options.lookup('ignored', {}, (_, address, family) => { assert.equal(address, PUBLIC_V6.address); assert.equal(family, 6); });
});

test('every redirect is revalidated and private DNS destinations never connect', async () => {
  const routes = { 'https://public.example.org/': { status: 302, headers: { location: 'http://private.example.org/secret' } } };
  const { fetch, calls, lookups } = fixture(routes, async host => host.startsWith('private') ? [{ address: '169.254.169.254', family: 4 }] : [PUBLIC_V4]);
  await assert.rejects(fetch('https://public.example.org/'), /private|reserved/);
  assert.equal(calls.length, 1); assert.equal(lookups.length, 2);
});

test('redirect to token URL or non-HTTP scheme is rejected; maximum five redirects', async () => {
  for (const location of ['http://127.0.0.1/', 'file:///etc/passwd', '/?token=secret']) {
    const { fetch, calls } = fixture({ 'https://public.example.org/': { status: 302, headers: { location } } });
    await assert.rejects(fetch('https://public.example.org/')); assert.equal(calls.length, 1);
  }
  const { fetch, calls } = fixture({ 'https://public.example.org/': { status: 302, headers: { location: '/' } } });
  await assert.rejects(fetch('https://public.example.org/'), /Too many redirects/);
  assert.equal(calls.length, 6);
});

test('relative public redirects produce final URL and no redirect cookies propagate', async () => {
  const { fetch, calls } = fixture({
    'https://public.example.org/': { status: 302, headers: { location: '/next', 'set-cookie': 'SECRET=value' } },
    'https://public.example.org/next': { body: '# Markdown', type: 'text/markdown' },
  });
  assert.deepEqual(await fetch('https://public.example.org/'), { url: 'https://public.example.org/next', content: '# Markdown' });
  assert.equal(calls.length, 2); assert.equal(calls[1].options.headers.Cookie, undefined);
});

test('bounded HTML extraction removes scripts, decodes entities and extracts title', async () => {
  const { fetch } = fixture({ 'https://public.example.org/': { type: 'text/html; charset=utf-8', body: '<html><head><title>A &amp; B</title><style>BAD CSS</style></head><body><script>BAD SCRIPT</script><p>Hello &#x41; &lt;world&gt;</p><p>Next</p></body></html>' } });
  const result = await fetch('https://public.example.org/');
  assert.equal(result.title, 'A & B'); assert.match(result.content, /Hello A <world>/); assert.match(result.content, /Next/);
  assert.doesNotMatch(result.content, /BAD SCRIPT|BAD CSS/);
});

test('JSON and markdown are preserved; PDF and compressed/binary bodies fail clearly', async () => {
  for (const type of ['application/json', 'application/ld+json', 'text/plain', 'text/markdown']) {
    const { fetch } = fixture({ 'https://public.example.org/': { type, body: '{"hello":"world"}' } });
    assert.equal((await fetch('https://public.example.org/')).content, '{"hello":"world"}');
  }
  for (const [route, error] of [
    [{ type: 'application/pdf', body: '%PDF' }, /PDF is unsupported/],
    [{ type: 'image/png' }, /Unsupported/],
    [{ type: 'text/plain', headers: { 'content-encoding': 'gzip' } }, /Compressed/],
    [{ status: 403 }, /HTTP 403/],
  ]) {
    const { fetch } = fixture({ 'https://public.example.org/': route });
    await assert.rejects(fetch('https://public.example.org/'), error);
  }
});

test('limits actual streamed bytes and declared length, even if chunks are individually small', async () => {
  for (const route of [{ chunks: [Buffer.alloc(3), Buffer.alloc(3)] }, { headers: { 'content-length': '100' } }]) {
    const { fetch, destroyed } = fixture({ 'https://public.example.org/': route });
    await assert.rejects(fetch('https://public.example.org/', { maxBytes: 5 }), /size limit/);
    assert.ok(destroyed.length);
  }
  const { fetch } = fixture();
  await assert.rejects(fetch('https://public.example.org/', { maxBytes: 2 * 1024 * 1024 + 1 }), /maxBytes/);
});

test('caller cancellation aborts in-flight request and pre-aborted calls never resolve DNS', async () => {
  const { fetch, destroyed, lookups } = fixture({ 'https://public.example.org/': { pending: true } });
  const controller = new AbortController();
  const promise = fetch('https://public.example.org/', { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('test cancellation'));
  await assert.rejects(promise, /test cancellation/); assert.ok(destroyed.length);
  const before = lookups.length;
  await assert.rejects(fetch('https://public.example.org/', { signal: controller.signal }), /test cancellation/);
  assert.equal(lookups.length, before);
});

test('overall timeout also bounds a stalled resolver and a stalled response', async () => {
  const dnsStall = fixture({}, () => new Promise(() => {}));
  await assert.rejects(dnsStall.fetch('https://public.example.org/', { timeoutMs: 10 }), /timed out/);
  assert.equal(dnsStall.calls.length, 0);
  const responseStall = fixture({ 'https://public.example.org/': { pending: true } });
  await assert.rejects(responseStall.fetch('https://public.example.org/', { timeoutMs: 10 }), /timed out/);
  assert.ok(responseStall.destroyed.length);
});
