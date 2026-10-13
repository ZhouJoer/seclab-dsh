---
kind: upgrade-guide
description: "The security prototype entry is removed, configuration Remotes return objects, and failed probes and observations reject explicitly."
---

# Security workbench entry points and failures

English | [中文](guide.zh.md)

## Change

The experimental security package removes its `./legacy` prototype entry. The current workbench and its provider entries remain available. Existing prototype archives are not rewritten or deleted.

`configuration()` and `configureWorkspace()` return `WorkbenchConfiguration` objects instead of JSON strings. Task creation requires an attempt limit from saved workspace settings or `taskIntake.maxAttempts`; the client does not substitute three attempts.

The source manifest reader takes `sourceManifest(store, asset)` instead of an analysis context.

Tool discovery tries another executable only when a candidate is absent. A selected executable's failed version query, timeout or malformed response reports an error. Failed or cancelled observations and approved executions reject after saving available evidence; repeating the same operation reports its saved failure without executing again. Incomplete observations without a failure remain readable. Successful Frida responses require a nonempty version.

Coordinator exploration tools also reject when `analysisProgressCalls` recorded calls (default 12) lack a checkpoint update. This requests saved progress before execution and adds no failed activity record. Evidence reads, native-call capture, checkpoint commands and job cleanup remain available.

## Migration

1. Remove `@deepseek-ai/dsh-experimental-security-analysis/legacy` from custom compositions. Use the current [security profile](../../../../packages/experimental/security-profile/README.md). Keep existing prototype JSON archives and import them explicitly with the workbench's `import-legacy` command; import original samples separately to establish measured identity.
2. Update custom Remote clients to consume configuration objects directly, removing `JSON.parse`. Regenerate clients against the matching Host package. Set `taskIntake.maxAttempts` or save an explicit attempt limit in the workspace resource form before creating a task.
3. Repair a failing selected executable or explicitly select another installation. Confirm that the tool check reports the intended executable and version before saving its configuration.
4. Handle rejected collection and execution calls as failures. Inspect their saved evidence and activity rather than inferring success from an evidence record. Correct the cause before requesting a new operation; retrying an existing identity does not rerun it.
5. Update source-level `sourceManifest(context)` calls to `sourceManifest(context.artifacts, context.asset)`.
6. When a tool requests research progress, save `security_command` action `checkpoint` with the current conclusion, next action and saved evidence references, then retry the analysis. Reuse the checkpoint ID for the same question; create another when the question or phase changes. Configure `analysisProgressCalls` on the security-workbench plugin to adjust the interval. Confirm that the saved direction appears and the next analysis call executes.
