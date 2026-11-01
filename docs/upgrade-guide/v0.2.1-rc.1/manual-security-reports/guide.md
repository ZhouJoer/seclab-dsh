---
kind: upgrade-guide
description: "Security task completion saves outcomes without automatically publishing a report."
---

# Generate security reports explicitly

English | [中文](guide.zh.md)

## Change

`security_command` action `complete-task` saves verified outcomes with completion status `saved`. It no longer publishes a report. Existing reports remain readable. Consumers of the experimental security workbench must accept `saved` and the optional checkpoint/evidence references on saved outcomes and reports.

## Migration

1. Use `security_complete` or `complete-task` to submit results and evidence. Do not expect a report ID in that receipt.
2. Generate the report from the Reports controls, or issue `security_command` action `report` after an explicit user request.
3. Confirm that submission shows saved outcomes without a report; manual generation returns the report link. Failed publication retains the submission for retry.
