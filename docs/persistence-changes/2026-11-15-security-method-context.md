---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-15-security-method-context

English | [中文](2026-11-15-security-method-context.zh.md)

## Summary

Records automatically supplied security investigation and selected module entry methods in user/message context.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-15-security-method-context
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-07-helper-output-recovery"
    after: "52927bcd06f70d6d9eaf1808c2ffb0070957912ad622b6df3cdc0b71d7a3d4a3"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-07-helper-output-recovery"
    after: "cd7e1458bfb5d75f2da7fdd883e83f55ef84312774fe5cd292547dfb199352cc"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-07-helper-output-recovery"
    after: "0e2ce831ecc0bbe811ea917eeb51317c5a53c431160ff33b29952a0161e13cda"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-07-helper-output-recovery"
    after: "8922edb52da6b100465e8cff4265ebc22b9b5c825f2b63dfd3419da9211da34b"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The security-method discriminator identifies a new instructions message source with required name and form fields. Existing sources retain their fields and meaning. New readers accept older logs without automatic method messages and reconstruct retained method state from existing explicit skill injections and successful complete skill results. Older readers retain the complete message text and treat the unfamiliar source as opaque context; it cannot be mistaken for a user command, skill tool call or permission. Session format remains unchanged.

<a id="verification"></a>
## Verification

The security-analysis Loader, methods and module suites passed 172 tests with three existing skips. They cover delivery before task work, selected entry methods, explicit-load deduplication, seed replay, compaction recovery, precise adapter routing and unchanged auxiliary Shell permissions. The keyless security-native-citations scenario asserts both automatic methods precede its first tool call.

<a id="dev-note"></a>
## Dev Note

None.
