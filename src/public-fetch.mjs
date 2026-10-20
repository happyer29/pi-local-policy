import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

const MAX_BYTES = 2 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const SECRET_PARAM = /(?:^|[\[\]._-])(?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|api[_-]?key|key|authorization|auth|password|passwd|secret|client[_-]?secret|credential|signature|sig|code|session(?:[_-]?id)?|csrf(?:[_-]?token)?|jwt(?:[_-]?token)?|bearer|ticket)(?:$|[\[\]._-])|^(?:x-amz|x-goog)-/i;
const SECRET_VALUE = /(?:\bBearer\s+|\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/;

function ipv6Bytes(address) {
  let text = address.toLowerCase();
  if (text.includes('.')) {
    const i = text.lastIndexOf(':');
    const v4 = text.slice(i + 1).split('.').map(Number);
    text = `${text.slice(0, i)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const sides = text.split('::');
  const left = sides[0] ? sides[0].split(':') : [];
  const right = sides[1] ? sides[1].split(':') : [];
  const words = sides.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return words.flatMap(word => { const n = parseInt(word, 16); return [n >> 8, n & 255]; });
}

/** Conservative public-unicast classification; all other ranges fail closed. */
export function isPublicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6) return false;
  const b = ipv6Bytes(address);
  // Only global unicast 2000::/3; reject IPv4 maps, ULA, link-local,
  // multicast, NAT64, unspecified and loopback by construction.
  if ((b[0] & 0xe0) !== 0x20) return false;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] < 2) return false; // 2001::/23 special use
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false;
  if (b[0] === 0x20 && b[1] === 0x02) return false; // 6to4 can embed private IPv4
  if (b[0] === 0x3f && b[1] === 0xff && (b[2] & 0xf0) === 0) return false; // documentation
  return true;
}

function validateUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Expected an absolute public HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public HTTP(S) pages are supported.');
  if (url.username || url.password) throw new Error('URLs containing credentials are blocked.');
  if (url.port) throw new Error('Only standard HTTP(S) ports are supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || host.includes('%') || (!isIP(host) && (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host)))) {
    throw new Error('Local, internal and reserved hosts are blocked.');
  }
  let decoded;
  try { decoded = decodeURIComponent(`${url.pathname}${url.search}${url.hash}`); }
  catch { throw new Error('Malformed URL encoding.'); }
  const fragmentParams = new URLSearchParams(url.hash.slice(1));
  for (const [key] of [...url.searchParams, ...fragmentParams]) {
    if (SECRET_PARAM.test(key) || /token|secret|password|passwd|credential|signature|authorization|api[_-]?key/i.test(key)) throw new Error('URLs containing tokens or authentication parameters are blocked.');
  }
  if (SECRET_VALUE.test(decoded)) throw new Error('URLs containing tokens or credentials are blocked.');
  url.hash = '';
  return { url, host };
}

function abortError(signal) { return signal.reason instanceof Error ? signal.reason : new Error('Public page request cancelled.'); }
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const stop = () => reject(abortError(signal));
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

function entities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, key) => {
    if (key[0] !== '#') return named[key.toLowerCase()] ?? whole;
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
  });
}

function pageContent(body, type) {
  if (type !== 'text/html' && type !== 'application/xhtml+xml') return { content: body.trim() };
  const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const clean = text => entities(text.replace(/<[^>]*>/g, ' ')).replace(/[\t ]+/g, ' ').trim();
  const content = clean(body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(?:p|div|main|article|section|h[1-6]|li|tr|br|pre)\b[^>]*>/gi, '\n'))
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return { ...(titleMatch ? { title: clean(titleMatch[1]).slice(0, 500) } : {}), content };
}

/** Dependency seam for offline tests. Dependencies are trusted extension code. */
export function createPublicFetcher({ lookup = dnsLookup, request = (url, options, callback) => (url.protocol === 'https:' ? https : http).request(url, options, callback) } = {}) {
  return async function fetchPublicPage(input, { signal, timeoutMs = 15_000, maxBytes = MAX_BYTES } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('timeoutMs must be between 1 and 60000.');
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new Error('maxBytes must be between 1 and 2097152.');
    const controller = new AbortController();
    const stop = () => controller.abort(signal?.reason);
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Public page request timed out.')), timeoutMs);
    const activeSignal = controller.signal;
    try {
      let current = input;
      for (let redirects = 0; ; redirects++) {
        if (activeSignal.aborted) throw abortError(activeSignal);
        const { url, host } = validateUrl(current);
        const literalFamily = isIP(host);
        const addresses = literalFamily ? [{ address: host, family: literalFamily }] : await abortable(lookup(host, { all: true, verbatim: true }), activeSignal);
        if (!Array.isArray(addresses) || !addresses.length || addresses.some(item => !isPublicAddress(item.address) || item.family !== isIP(item.address))) {
          throw new Error('Host resolves to a private, local, reserved or invalid address.');
        }
        const selected = addresses[0];
        const result = await new Promise((resolve, reject) => {
          let req; let res; let settled = false;
          const done = (error, result) => {
            if (settled) return;
            settled = true;
            activeSignal.removeEventListener('abort', cancel);
            error ? reject(error) : resolve(result);
          };
          const cancel = () => { const error = abortError(activeSignal); done(error); req?.destroy(error); res?.destroy(); };
          const fail = error => { done(error); req?.destroy(); res?.destroy(); };
          activeSignal.addEventListener('abort', cancel, { once: true });
          if (activeSignal.aborted) { cancel(); return; }
          try {
            req = request(url, {
              method: 'GET', agent: false, family: selected.family, autoSelectFamily: false,
              lookup: (_hostname, options, callback) => options?.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
              headers: { 'User-Agent': 'Pi-Local-Policy/1.0 (public read-only fetch)', Accept: 'text/html, text/plain, text/markdown, application/json, application/xhtml+xml', 'Accept-Encoding': 'identity' },
              // No user headers, cookies, HTTP auth, proxies or reusable sockets.
            }, response => {
              res = response;
              res.on('error', fail);
              res.on('aborted', () => fail(new Error('Public page response was interrupted.')));
              const status = res.statusCode ?? 0;
              if (REDIRECTS.has(status)) {
                if (redirects >= 5) { fail(new Error('Too many redirects (maximum 5).')); return; }
                const location = res.headers.location;
                if (!location || typeof location !== 'string') { fail(new Error('Redirect has no valid Location.')); return; }
                let next;
                try { next = new URL(location, url).href; } catch { fail(new Error('Redirect has an invalid URL.')); return; }
                done(null, { redirect: next });
                res.destroy();
                return;
              }
              if (status < 200 || status >= 300) { fail(new Error(`Public page returned HTTP ${status}.`)); return; }
              const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
              if (type === 'application/pdf') { fail(new Error('PDF is unsupported by public web_fetch; use an explicitly authorized document workflow.')); return; }
              if (!['text/html', 'text/plain', 'text/markdown', 'text/x-markdown', 'application/json', 'application/xhtml+xml'].includes(type) && !/^application\/[a-z0-9.-]+\+json$/.test(type)) {
                fail(new Error('Unsupported page content type; expected HTML, plain text, Markdown or JSON.')); return;
              }
              if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { fail(new Error('Compressed responses are unsupported.')); return; }
              const size = Number(res.headers['content-length']);
              if (Number.isFinite(size) && size > maxBytes) { fail(new Error('Public page exceeds the response size limit.')); return; }
              let bytes = 0; const chunks = [];
              res.on('data', chunk => {
                if (settled) return;
                const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                bytes += data.length;
                if (bytes > maxBytes) { fail(new Error('Public page exceeds the response size limit.')); return; }
                chunks.push(data);
              });
              res.on('end', () => done(null, { url: url.href, ...pageContent(Buffer.concat(chunks).toString('utf8'), type) }));
            });
            req.on('error', error => done(error));
            req.end();
          } catch (error) { fail(error); }
        });
        if (!result.redirect) return result;
        current = result.redirect;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  };
}

export const fetchPublicPage = createPublicFetcher();
