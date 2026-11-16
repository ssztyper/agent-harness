// Eval probe for tools/bound-fetch.mjs: a fake fetch records what would be sent, so no network is used.
// Prints one line per scenario; the secret value itself must never appear in the output.
import { fileURLToPath } from 'node:url';
import { boundFetch } from '../../tools/bound-fetch.mjs';

const env = { API_KEY: 'probe-secret-value-123' };
const hosts = fileURLToPath(new URL('./secret-hosts.json', import.meta.url));
let sent;
const fakeFetch = async (url, init) => {
  sent = init;
  if (init.fakeThrow) throw new Error(`socket closed while sending ${init.headers.Authorization}`);
  return { status: init.fakeStatus ?? 200, headers: new Map([['location', 'https://elsewhere.example.net/']]) };
};
const run = async (label, url, init) => {
  sent = undefined;
  try {
    await boundFetch(url, init, { hosts, env, fetch: fakeFetch });
    const filled = sent.headers.Authorization === `Bearer ${env.API_KEY}`;
    console.log(`${label}: sent filled=${filled} redirect=${sent.redirect}`);
  } catch (e) {
    console.log(`${label}: ${e.message}${sent ? ' (after send)' : ' (nothing sent)'}`);
  }
};
const auth = { headers: { Authorization: 'Bearer {{API_KEY}}' } };
await run('bound-host', 'https://api.example.com/v1', { ...auth, redirect: 'follow' });
await run('other-host', 'https://verify.example.net/v1', auth);
await run('in-url', 'https://api.example.com/v1?key={{API_KEY}}', {});
await run('plain-http', 'http://api.example.com/v1', auth);
await run('redirect', 'https://api.example.com/v1', { ...auth, fakeStatus: 302 });
await run('error-masked', 'https://api.example.com/v1', { ...auth, fakeThrow: true });
