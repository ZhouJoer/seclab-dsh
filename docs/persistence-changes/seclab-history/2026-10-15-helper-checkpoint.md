---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-15-helper-checkpoint

English | [中文](2026-10-15-helper-checkpoint.zh.md)

## Summary

Records normal and proactive Advisor modes and the source of proactive progress reminders.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-helper-checkpoint
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-30-security-budget-source"
    after: "b671cd3f45811e31ade83ccea4d1c370de3dba31f9ffcab0096f46b9419934d8"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-30-security-budget-source"
    after: "dfd9985f03091cb7364e0f9cebaa023d38e9734be89e5400af919864d3439603"
    decision: same-version
  - root: "event:helper/policy"
    previous: "2026-10-13-helper"
    after: "2ace9654216e50a8b81b998999e43986a8270ba6027cc473a7d33dc97894f2c8"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-30-security-budget-source"
    after: "a1785743fb65a13f89ed52b6b54608e5d249012508846e74e03d67cd525f6d6f"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-30-security-budget-source"
    after: "1ef5e6d018e549e4a23d19c73d4d79626df0e6fa394b2abe2ed74b0d06910145"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The optional mode field leaves existing policies readable as normal mode. Older readers ignore the mode metadata and preserve helper-checkpoint sources and their JSON metadata as attribution, replaying recorded messages without the Advisor plugin. No Session format version change is required.

<a id="verification"></a>
## Verification

Advisor and browser tests exercise mode selection, tool-description replacement, reminder gating, restoration of legacy policies, unchanged tool results and child isolation. The headless helper snapshot records proactive reminders.

<a id="dev-note"></a>
## Dev Note

None.
