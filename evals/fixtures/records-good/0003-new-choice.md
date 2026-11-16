# 3. Move export to the API

Status: proposed
Date: 2026-02-01

## Context
The button exported more fields than a viewer may see.

## Decision
Export only through the API, which checks the viewer's rights. Proposed by the agent; waits for the owner.

## Consequences
+ One place checks rights.
− Users without API access lose the export.
