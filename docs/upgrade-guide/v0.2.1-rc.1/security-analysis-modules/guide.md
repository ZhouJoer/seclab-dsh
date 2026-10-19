---
kind: upgrade-guide
description: "Security specialist operations now require a selected task module."
---

# Security analysis modules

English | [中文](guide.zh.md)

## Change

Specialist security skills and tools require an active task module. Historical tasks without `moduleSelection` remain readable and start in automatic mode with common investigation capabilities. Direct integrations that previously invoked specialist providers immediately must select a module first. Saved tasks with module selections or JAR assets require the updated security plugin; older strict readers may reject those records. Session format is unchanged. `security_scope` rejects unknown record kinds; use `asset` for materials and `engagement` for the task, or omit `kind` to list all record types.

## Migration

1. Open the task and use automatic selection, or select its modules manually in task details.
2. For model or command integrations, read `security_capabilities`, then submit `security_command` with action `modules` and selection `{mode:"auto",modules:["reverse.android"],reason:"Imported APK"}` using the latest revision. Manual selections are operator-owned.
3. Check the active resource list before calling a specialist adapter. Combine `reverse.android` and `reverse.native` for JNI work. Existing execution approvals and adapter-only Shell restrictions still apply.
