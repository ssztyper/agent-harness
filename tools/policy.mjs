#!/usr/bin/env node
// Autonomy policy for custom agents: the alone / ask / never line as data, not as prompt text.
// The shell guard covers Claude Code's own tools; an agent you build (a bot, a ticket runner) calls this
// before every act, because a model that "knows" the rules still drifts under pressure.
// Two rules hold whatever the table says: an act the table does not name asks (never a silent default),
// and an act the model guessed (not named by the request itself) is never done alone.
// module: import { loadPolicy, gate } from './policy.mjs'; gate(policy, 'comment', { guessed: true })
//         → { decision: 'ask', reason: '...' }
// cli:    node tools/policy.mjs <policy.json> <act> [--guessed]
//         prints the decision on stdout and the reason on stderr; exit 0 alone, 3 ask, 4 never, 2 bad input.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LEVELS = ['alone', 'ask', 'never'];

// A table: { "acts": { "<name>": { "level": "alone|ask|never", "why": "<reason>" } } }.
// A broken table throws: an agent with no readable policy must not fall back to "alone".
export function loadPolicy(file) {
  const policy = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, rule] of Object.entries(policy.acts ?? {})) {
    if (!LEVELS.includes(rule?.level)) throw new Error(`policy ${file}: act "${name}" has level ${JSON.stringify(rule?.level)}, expected ${LEVELS.join(' | ')}`);
    if (!rule.why) throw new Error(`policy ${file}: act "${name}" has no "why"`);
  }
  return policy;
}

export function gate(policy, act, { guessed = false } = {}) {
  const rule = policy.acts?.[act];
  if (!rule) return { decision: 'ask', reason: `"${act}" is not in the policy table; an unknown act asks` };
  if (guessed && rule.level === 'alone') {
    return { decision: 'ask', reason: `"${act}" runs alone only when the request names it; the model guessed it` };
  }
  return { decision: rule.level, reason: rule.why };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const [file, act] = args.filter((a) => !a.startsWith('--'));
  if (!file || !act) {
    console.error('usage: node tools/policy.mjs <policy.json> <act> [--guessed]');
    process.exit(2);
  }
  let policy;
  try { policy = loadPolicy(file); } catch (e) { console.error(e.message); process.exit(2); }
  const { decision, reason } = gate(policy, act, { guessed: args.includes('--guessed') });
  console.log(decision);
  console.error(`reason: ${reason}`);
  process.exit({ alone: 0, ask: 3, never: 4 }[decision]);
}
