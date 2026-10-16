---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-16-security-task-context

English | [中文](2026-10-16-security-task-context.zh.md)

## Summary

Adds the security-task-context message attribution for operator declarations and task background.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-16-security-task-context
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-15-helper-checkpoint"
    after: "7fed426009307b1cdd263736102b8fdb6abe133dc145d52f1d94f2d898e4555a"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-15-helper-checkpoint"
    after: "0b76e60e47faba9a3cca29d341baedad6bade0e9c4bd6ed4b2f2c96c9ee817e5"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-15-helper-checkpoint"
    after: "c8fc4d7b08e9c7f7ca96339ee4521c8a07b0c5ebbca028e9fdf73d26de319606"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-15-helper-checkpoint"
    after: "d73f47655ee83ddff7e262062b02c2edc0df46fd0d99b1b7e859e27cc4b14e1c"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The new source records attribution on existing model-visible messages without changing their content or replay semantics. Existing messages remain valid and need no authorization declaration. A Session projection reconstructs the latest snapshot and its retention from those events; no historical message is rewritten.

<a id="verification"></a>
## Verification

node node_modules/vitest/vitest.mjs run scripts/client-bundle-purity.spec.ts packages/experimental/security-analysis/tests/task-context-projection.spec.ts: 43 tests passed, including projection remount, compaction removal, expiry and clearing.

<a id="dev-note"></a>
## Dev Note

None.
