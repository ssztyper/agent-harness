# Security

This harness runs hooks and scripts inside your agent's session, so a bug here can let an agent do more than
you meant. Please report security problems privately.

- **Report:** use GitHub's "Report a vulnerability" (Security tab → Advisories) on this repository.
  Do not open a public issue for a security problem.
- **What helps:** the file and line, what an agent or input could do, and a minimal way to show it.
- **Scope:** the outward guard (`hooks/outward-guard.mjs`), the CI worker's secret handling
  (`workers/ci-worker/run.sh`), anything that could leak a secret into a log, a repo or a model.
- **Not in scope:** what your own agent or model provider does outside these files.

You will get an answer within a week. Fixes come with an eval case so the same hole cannot reopen.
