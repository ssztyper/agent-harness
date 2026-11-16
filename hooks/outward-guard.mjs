#!/usr/bin/env node
// PreToolUse hook (Bash and MCP tools): the autonomy line in code. Reads, builds and local edits run alone;
// anything others can see (push, repo, secret, issue, deploy, POST) asks the human first;
// a few commands that cannot be undone are refused. Every ask/deny is logged to log/autonomy.jsonl
// (AUTONOMY_LOG overrides the path), with long token-like strings masked.
// MCP tools and the host allowlist come from outward-tools.json next to this file, because an MCP tool
// that sends mail is as outward as `git push`, and a shell guard alone never sees it.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DENY = [
  [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)(\s|$)/, 'deletes a whole disk or home folder'],
  [/\bgit\s+push\b.*--force\b.*\b(main|master)\b/, 'force-push rewrites shared history'],
];
const ASK = [
  [/\bgit\s+push\b/, 'push: others see it'],
  [/\bgh\s+repo\s+(create|delete|edit|rename|archive|fork)\b/, 'repo change on GitHub'],
  [/\bgh\s+secret\s+(set|delete)\b/, 'secret change on GitHub'],
  [/\bgh\s+(issue|pr)\s+(create|comment|close|reopen|edit|merge|review)\b/, 'issue or PR others read'],
  [/\bgh\s+(workflow\s+run|release\s+create|run\s+delete)\b/, 'CI run or release on GitHub'],
  [/\bgh\s+api\b.*(-X\s*(POST|PUT|PATCH|DELETE)|--method\s+(POST|PUT|PATCH|DELETE))/i, 'GitHub API write'],
  [/\bwrangler\s+(deploy|secret|delete|d1\s+execute\b.*--remote|kv\s+key\s+(put|delete)\b.*--remote)/, 'Cloudflare change'],
  [/\b(curl|wget)\b.*(\s-X\s*(POST|PUT|PATCH|DELETE)|\s--data\b|\s-d\s|\s-F\s|--form\b|--upload-file\b)/i, 'HTTP write to a server'],
  [/\b(npm|pnpm|yarn)\s+publish\b/, 'package publish'],
  [/\b(podman|docker)\s+push\b/, 'image push'],
];

// A write sign in the raw command, quoted text included: inline scripts (node -e, python - <<EOF) live in quotes.
const WRITE_SIGN = /\b(POST|PUT|PATCH|DELETE)\b|--data\b|--json\b|--post-(data|file)\b|\.(post|put|patch)\s*\(|\bmethod\s*[:=]/;

// Unreadable config fails closed: every MCP tool asks and no host is trusted for writes.
function loadConfig() {
  try {
    const c = JSON.parse(readFileSync(new URL('./outward-tools.json', import.meta.url), 'utf8'));
    return { tools: (c.tools ?? []).map((t) => [new RegExp(t.pattern, 'i'), t.why, t.decision ?? 'ask']), writeHosts: c.writeHosts ?? [] };
  } catch {
    return { tools: [[/^mcp__/, 'outward-tools.json is unreadable, so every MCP tool asks', 'ask']], writeHosts: [] };
  }
}

function judgeTool(name, config) {
  const hit = config.tools.find(([re]) => re.test(name));
  return hit ? { decision: hit[2] === 'deny' ? 'deny' : 'ask', reason: hit[1] } : null;
}

function judgeShell(cmd, config) {
  // Match only what the shell runs: heredoc bodies and quoted strings are text, not commands
  // (an edit that writes "gh secret set" into a file must not ask).
  const code = cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g, '<<heredoc')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const hit = (list) => list.find(([re]) => re.test(code));
  const deny = hit(DENY);
  if (deny) return { decision: 'deny', reason: deny[1] };
  const ask = hit(ASK);
  if (ask) return { decision: 'ask', reason: ask[1] };
  // Third route: a write to a host nobody listed, even from an inline script no pattern above knows.
  if (WRITE_SIGN.test(cmd)) {
    const hosts = [...cmd.matchAll(/\bhttps?:\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])/gi)].map((m) => m[1].toLowerCase());
    const unknown = hosts.find((h) => !config.writeHosts.includes(h));
    if (unknown) return { decision: 'ask', reason: `HTTP write to ${unknown}, a host not on the write allowlist` };
  }
  return null;
}

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  let call;
  try { call = JSON.parse(input); } catch { process.exit(0); }
  const tool = call.tool_name ?? '';
  const cmd = call.tool_input?.command ?? '';
  const config = loadConfig();
  const verdict = tool && tool !== 'Bash' ? judgeTool(tool, config) : judgeShell(cmd, config);
  if (!verdict) process.exit(0);
  const { decision, reason } = verdict;
  const what = tool && tool !== 'Bash' ? `${tool} ${JSON.stringify(call.tool_input ?? {})}` : cmd;
  const log = process.env.AUTONOMY_LOG ?? join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), 'log', 'autonomy.jsonl');
  if (log !== '/dev/null') {
    try {
      mkdirSync(dirname(log), { recursive: true });
      const masked = what.replace(/[A-Za-z0-9_\-.]{40,}/g, '<masked>').slice(0, 400);
      appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), decision, reason, cmd: masked }) + '\n');
    } catch {}
  }
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `Outward guard: ${reason}. ${decision === 'ask' ? 'The human decides; one yes covers this one action.' : 'Refused: cannot be undone.'}`,
    },
  }));
});
