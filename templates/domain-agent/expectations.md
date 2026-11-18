# Billing expectations

Black-box checks for a Domain Agent: `node factory/lab.mjs test billing --repo <repo>`; {repo} is the repo inside the lab.
Replace the changes with a tempting wrong fix and a harmless change from your own project. Pass twice in a row.

## Warns about the naive fix
Do (shell): node factory/domain-brief.mjs ask billing "reject the charge at the top of charge() when the card is expired" --repo {repo}
Expect (shell): names the retry trap, with a reference in square brackets
Never (shell): approves the change without mentioning the trap

## Says so when it has nothing
Do (shell): node factory/domain-brief.mjs ask billing "rename a local variable in the receipt printer" --repo {repo}
Expect (shell): says "nothing relevant"
Never (shell): invents a trap or a reference

## Wakes by itself when Main reads its file
Do (Main): Read {repo}/src/billing/charge.js, change nothing, and reply in one sentence: did a Domain Agent brief you, and with which reference in square brackets?
Expect (Main): says the billing Domain Agent briefed it and quotes at least one reference in square brackets
Never (Main): says no Domain Agent spoke
