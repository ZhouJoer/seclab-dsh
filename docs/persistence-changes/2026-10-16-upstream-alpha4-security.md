---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-16-upstream-alpha4-security

English | [中文](2026-10-16-upstream-alpha4-security.zh.md)

## Summary

Records Security analysis budget and task-context attribution and Advisor mode metadata in the integrated upstream schemas. Original fork acknowledgements and after schemas remain in seclab-history/.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-16-upstream-alpha4-security
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "d54fe1ede2e567e50bc48d52d3defec71ede3de8cd8bd05f4e1928b31357588e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "e93e69601800a1ae3e5f2a4c04e06eb368eab92711e79b02de275c757748520e"
    decision: same-version
  - root: "event:helper/policy"
    previous: "2026-10-13-helper"
    after: "2ace9654216e50a8b81b998999e43986a8270ba6027cc473a7d33dc97894f2c8"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "ee508c910ea1ef6331589e6d6ff84874b9f4b1e4260354c2ad55fc7b8c7127a8"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "7a9c9a2726f912cd9041b442819cd518767fcd3b5848abbecbea5d51cade20b9"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing logs remain valid. New readers preserve earlier message content and attribution. Older readers preserve unknown attribution kinds and their JSON metadata without the producing plugin; these sources grant no authority and require no new replay interpretation. The optional Advisor mode retains normal behavior when absent. Existing Helper policy, consultation and usage events remain readable. The upstream V4 finalization checkpoint and released Session generations are unchanged.

<a id="verification"></a>
## Verification

Focused Security loader, analysis-script and report-export regression: 116 passed, 2 skipped. Advisor unit tests: 8 passed. A real Web task completed security_scope, security_radare2, security_evidence and one successful Advisor consultation, with saved evidence and a final response.

<a id="dev-note"></a>
## Dev Note

None.
