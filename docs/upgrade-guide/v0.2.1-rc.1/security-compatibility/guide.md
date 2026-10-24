---
kind: upgrade-guide
description: "Job wait defaults and the security progress Remote change; saved workbench patches now take precedence over launcher defaults."
---

# Security workbench compatibility

English | [中文](guide.zh.md)

## Change

The source security launcher no longer injects a complete highest-priority workbench configuration. Bundle defaults precede profile, home and explicit CLI patches. Existing project data and tool files are retained. The security preset keeps activity waits capped at one minute; other compositions default to completion waits with a ten-minute maximum. The read-only progress stream accepts a Session identity without resolving an active Agent.

## Migration

1. Review the `security-workbench` row in your profile and home `cordis.patch.yml`. A patch replaces the entire plugin configuration; retain the environments and other required fields when setting budgets, data roots or evolution preferences. Confirm effective precedence with `pnpm security --dump-config`.
2. Keep existing tool files. Set `toolConfiguration.path` explicitly if you use a custom location. Bundle defaults prefer the workspace file and otherwise retain an existing Harness-home `security/tools.json`. Select an environment JSON file with `environmentConfigurationPath`; only its environment declarations and optional intake defaults are applied.
3. Custom presets needing progress-based returns must set `tool-jobs.config.waitMode: activity` and `maxWaitTimeoutMs: 60000`. The shipped security preset already does so.
4. Regenerate external Remote clients. Named wire arguments for `securityWorkbench/followSessionView` use `sessionId` instead of `agent`; the positional identifier remains the same. Access still requires authorization for that Session.
5. Retain the required helper and advisor events and all historical Session generations. Package version equality alone does not establish reader compatibility. Review the [patch inventory](../../../../scripts/security-compatibility.json) and run `pnpm run check:security-compatibility` after each upstream merge.
