# Gatherer expectations

What we expect from `workers/phone/gather.mjs` before its brief goes in front of a delegated task. Each Do line is a
command run from the project root; the checks read only the brief it prints.
`node workers/phone/gather.test.mjs` checks all three offline.

## Cites a source on every line
Do (Gatherer): node workers/phone/gather.mjs "add a --quiet flag to workers/phone/job.sh"
Expect (Gatherer): every line under a heading ends with `· source: <file:line | commit sha | issue url | session file:line | command>` or says "(no source: assumption)"
Expect (Gatherer): a gatherer that finds nothing says "Nothing relevant" with the place it searched
Never (Gatherer): prints a finding without a source, or more than 120 lines
Never (Gatherer): quotes a secret-shaped string, even partly

## Skips gatherers the task does not need
Do (Gatherer): node workers/phone/gather.mjs "find where moshi-hook is called"
Expect (Gatherer): runs only the code gatherer and names each skipped gatherer with one reason
Never (Gatherer): runs the GitHub gatherer for a task that names no repo or issue
Never (Gatherer): calls gh or the network for a code-only task

## Never invents a file
Do (Gatherer): node workers/phone/gather.mjs "add a --quiet flag to workers/phone/job.sh and workers/phone/no-such-file.sh"
Expect (Gatherer): every cited file:line exists and the line number is within the file
Expect (Gatherer): says that workers/phone/no-such-file.sh does not exist
Never (Gatherer): cites a file or line that is not on disk
