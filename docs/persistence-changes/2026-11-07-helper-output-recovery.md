---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-07-helper-output-recovery

English | [中文](2026-11-07-helper-output-recovery.zh.md)

## Summary

Adds helper-output-recovery notice attribution with the preceding incomplete assistant message sequence.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-07-helper-output-recovery
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-18-automatic-advisor-jev"
    after: "3ce401e2cc3b30f89d53c935221b81e6098c06ab7b265b931213d73b4733423a"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-18-automatic-advisor-jev"
    after: "7b75661c8a19ea6c4eff838314f1c33d84e30cd9acd5c9bbb18bdfce7b2146ff"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-18-automatic-advisor-jev"
    after: "fa1065e78d8ee7e339de44498ff81ebe4005b56e8a8c245938db27c603e77974"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-18-automatic-advisor-jev"
    after: "5093f651a360050c3d82b60fa7161f96b454bd35171ff6828905497e55c3bc98"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing source kinds and event fields retain their meanings. The new kind uses the existing notice form; older readers retain its text through the extensible message-source representation and do not infer successful research from it. New readers accept historical messages without this kind and derive recovery state only from recorded recovery notices and their own subsequent responses. No existing Session generation or finalized record is rewritten.

<a id="verification"></a>
## Verification

Helper unit and Loader tests passed (39 cases), including one recovery, repeated truncation, empty output, cancellation, tool denial, parent-child isolation, replay and human-message priority. Security workbench Loader tests passed for delivery after budget finalization and suppression of ordinary internal continuations (3 cases).

<a id="dev-note"></a>
## Dev Note

None.
