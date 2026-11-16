#!/usr/bin/env node
// Secrets bound to hosts in code. A request names a secret as {{NAME}} in a header; boundFetch fills it
// only when the URL's host is listed for that NAME, never in the URL or body, and never follows a redirect
// with it. A document or a model that asks to send a key to a new host gets a refusal, not a request,
// because a prompt that says "only send keys to the API" is advice, and a redirect or a manual can move it.
// module: import { boundFetch } from './bound-fetch.mjs';
//         await boundFetch(url, { headers: { Authorization: 'Bearer {{API_KEY}}' } }, { hosts: 'secret-hosts.json' })
//         values come from process.env (or opts.env); secret values are masked in every error.
// cli:    node tools/bound-fetch.mjs --check <NAME> <url> --hosts <secret-hosts.json>
//         answers without network: exit 0 when NAME may go to that host, 3 when it is refused, 2 bad input.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REF = /\{\{([A-Z0-9_]+)\}\}/g;

// hosts file: { "API_KEY": ["api.example.com"] }. Exact host names only: a wildcard is how keys leak.
export function loadHosts(file) {
  const hosts = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, list] of Object.entries(hosts)) {
    if (name.startsWith('_')) continue; // comments
    if (!Array.isArray(list) || list.some((h) => typeof h !== 'string' || h.includes('*'))) {
      throw new Error(`hosts ${file}: ${name} must be a list of exact host names`);
    }
  }
  return hosts;
}

// Why a secret may not go to a URL, or null when it may.
export function refusal(hosts, name, url) {
  let u;
  try { u = new URL(url); } catch { return `not a URL: ${url}`; }
  const listed = hosts[name];
  if (!Array.isArray(listed)) return `${name} is not bound to any host`;
  if (!listed.includes(u.hostname)) return `${name} is not bound to ${u.hostname} (bound: ${listed.join(', ') || 'none'})`;
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) return `${name} only travels over https, got ${u.protocol}`;
  return null;
}

export async function boundFetch(url, init = {}, opts = {}) {
  const hosts = typeof opts.hosts === 'string' ? loadHosts(opts.hosts) : opts.hosts ?? {};
  const env = opts.env ?? process.env;
  const doFetch = opts.fetch ?? fetch;
  const outside = `${url} ${typeof init.body === 'string' ? init.body : ''}`;
  const misplaced = [...outside.matchAll(REF)].map((m) => m[1]);
  if (misplaced.length) throw new Error(`refuse: secret references belong in headers only, found {{${misplaced[0]}}} in the URL or body`);
  const values = [];
  const headers = {};
  for (const [key, raw] of Object.entries(init.headers ?? {})) {
    headers[key] = String(raw).replace(REF, (_, name) => {
      const why = refusal(hosts, name, url);
      if (why) throw new Error(`refuse: ${why}`);
      const value = env[name];
      if (!value) throw new Error(`refuse: ${name} is not set`);
      values.push(value);
      return value;
    });
  }
  const mask = (s) => values.reduce((t, v) => t.split(v).join('<masked>'), String(s));
  try {
    const res = await doFetch(url, { ...init, headers, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`refuse: ${res.status} redirect to ${res.headers?.get?.('location') ?? '?'} is not followed with a secret`);
    }
    return res;
  } catch (e) {
    throw new Error(mask(e.message));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--check');
  const hostsAt = args.indexOf('--hosts');
  const [name, url] = at >= 0 ? args.slice(at + 1, at + 3) : [];
  if (!name || !url || hostsAt < 0 || !args[hostsAt + 1]) {
    console.error('usage: node tools/bound-fetch.mjs --check <NAME> <url> --hosts <secret-hosts.json>');
    process.exit(2);
  }
  let hosts;
  try { hosts = loadHosts(args[hostsAt + 1]); } catch (e) { console.error(e.message); process.exit(2); }
  const why = refusal(hosts, name, url);
  console.log(why ? `refuse: ${why}` : `ok: ${name} may go to ${new URL(url).hostname}`);
  process.exit(why ? 3 : 0);
}
