#!/usr/bin/env node
// Hook for /agent: feeds Main's conversation to supporting agents and hands queued findings back.
// UserPromptSubmit: appends the prompt to log/agent-feed/<session>.jsonl and, if findings were sent to Main
//   (`factory/agent.sh send main #n`), attaches them to this prompt as context and clears the queue.
// Stop: appends the last finished reply's text (no tool calls, results, images or reasoning).
// Sessions run by a supporting agent (AGENT_ROLE set) never feed, so an agent only ever follows Main.
// Never blocks: any error exits 0 with no output.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

try {
  if (process.env.AGENT_ROLE) process.exit(0);
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const feedDir = join(project, 'log', 'agent-feed');
  mkdirSync(feedDir, { recursive: true });
  const session = String(input.session_id || 'unknown').replace(/[^\w-]/g, '');
  const feed = join(feedDir, `${session}.jsonl`);
  const write = (role, text) => {
    if (!text || !text.trim()) return;
    appendFileSync(feed, JSON.stringify({ at: new Date().toISOString(), role, text: text.slice(0, 8000) }) + '\n');
    appendFileSync(join(feedDir, 'latest'), `${session}\n`);
  };

  if (input.hook_event_name === 'UserPromptSubmit') {
    write('user', input.prompt || '');
    const queue = join(feedDir, 'queue-main.jsonl');
    if (existsSync(queue)) {
      const taken = queue + '.taken';
      renameSync(queue, taken); // take the queue atomically, so a finding is attached once
      const items = readFileSync(taken, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      unlinkSync(taken);
      if (items.length) {
        const context = items.map((f) => `From the ${f.agent} (finding #${f.n}, sent by the human): ${f.text}`).join('\n');
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } }));
      }
    }
  } else if (input.hook_event_name === 'Stop') {
    let text = input.last_assistant_message || '';
    if (!text && input.transcript_path && existsSync(input.transcript_path)) {
      const lines = readFileSync(input.transcript_path, 'utf8').trimEnd().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        let e; try { e = JSON.parse(lines[i]); } catch { continue; }
        if (e.type === 'user' && !e.toolUseResult && typeof e.message?.content === 'string') break; // reached the prompt
        if (e.type === 'assistant') {
          const t = (e.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
          if (t.trim()) { text = t; break; }
        }
      }
    }
    write('assistant', text);
  }
} catch { /* a feed problem must never stop Main */ }
process.exit(0);
