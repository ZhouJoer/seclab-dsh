---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-18-automatic-advisor-jev

English | [中文](2026-10-18-automatic-advisor-jev.zh.md)

## Summary

Adds logged automatic Advisor consultations and Jev progress decisions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-18-automatic-advisor-jev
baseline: false
changes:
  - root: "event:advisor-jev/end"
    previous: null
    after: "20686cb8d3c4c9695cffa1b977d4359ade0a49a3c602819f651c30746b32537c"
    decision: same-version
  - root: "event:advisor-jev/start"
    previous: null
    after: "956fc811a25eb128e0fefdd69935e13c6cd885466428eb69181304eb247a79ff"
    decision: same-version
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-16-upstream-alpha4-security"
    after: "db9ea24689cc6db48459f61cecc6007aeaa308814ba819273a7427f561a1da07"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-16-upstream-alpha4-security"
    after: "d79f11c2c65107b317578fd73abead61f13c28ca559b903f34e3e70591ff5fbe"
    decision: same-version
  - root: "event:helper/auto-end"
    previous: null
    after: "7d14e49021273336b473a38d2a4ec06eabcedb9fd278522e0d8929c85c6a3364"
    decision: same-version
  - root: "event:helper/auto-start"
    previous: null
    after: "5213af0084150cd0c98f10f85cea07da08266983306dbd8b5509ea79e697d08c"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-16-upstream-alpha4-security"
    after: "abb3ee6648311fecc43e4592024f502e360b5eebaccc3a067f1b9c35f46e740d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-16-upstream-alpha4-security"
    after: "5a61344a559e3bdbfdde55ae454c4f9cc58db83fa29eff86b6cb69250f00b0c7"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing helper/start and helper/end payloads are unchanged. New helper/auto-start, helper/auto-end, advisor-jev/start and advisor-jev/end discriminators are required-on-read, so older readers refuse these records rather than silently losing model-visible advice. New readers retain existing logs. Helper projection state version 3 rebuilds cached state; no released generation changes.

<a id="verification"></a>
## Verification

Jev Loader and policy tests and existing Helper tests passed. The authored advisor-jev SDK scenario refresh passed through the built dsh SDK profile.

<a id="dev-note"></a>
## Dev Note

None.
