# Billing scenarios

Plain questions with the answer we expect, checked by `node factory/domain-check.mjs --repo <repo>` when files under
agents/ change. Never delete a scenario to make a check pass; when behaviour changes on purpose, update the glossary and
add a scenario. The values are examples.

## Retried charge
Ask: A charge succeeded, and the same request arrives again with the same key. What happens?
Expect: nothing is charged again; the first result is returned
Never: charges the customer a second time
