---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-30-analysis-outcomes-advisor-tools

English | [中文](2026-10-30-analysis-outcomes-advisor-tools.zh.md)

## Summary

Separates saved task outcomes from user-triggered report publication, adds explicit investigation references, and retains bounded native advisor tool records.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-30-analysis-outcomes-advisor-tools
baseline: false
changes:
  - root: "event:helper/codex-trace"
    previous: null
    after: "f12574b201f3c42fb53289c254bcdb9c66ef94a9810094ebae794679f8be6f17"
    decision: same-version
  - root: "event:subagent-codex/tool"
    previous: null
    after: "f027250e1441d585d0155fab972fbe39e7bda9bb22d0c7cf3d01a93a3eb6874d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing task completion states and reports remain readable; optional investigation references are absent on older data. Older strict security record readers reject the new saved status rather than treating it as published. The new helper/codex-trace and subagent-codex/tool Session event discriminators identify audit records, not tool executions or model messages. Readers that do not recognize required events refuse the Session instead of interpreting their payload as another event. New readers preserve existing events. No Session envelope version change is needed because the discriminators prevent unsafe interpretation.

<a id="verification"></a>
## Verification

181 focused tests passed across security workbench, investigation graph, helper consultations, Codex wire lifecycle and bounded tool records. Tests cover report retries/cancellation, saved outcomes before publication, legacy report references, native trace linkage and unchanged parent messages.

<a id="dev-note"></a>
## Dev Note

None.
