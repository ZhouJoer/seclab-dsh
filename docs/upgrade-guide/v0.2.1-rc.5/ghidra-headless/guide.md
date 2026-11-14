---
kind: upgrade-guide
description: "Ghidra headless replaces the GUI bridge, its tool entry and provider configuration."
---

# Use Ghidra headless for binary analysis

English | [中文](guide.zh.md)

## Change

Ghidra analysis uses `security_ghidra_headless`. The `security_ghidra` GUI bridge, `ghidra` tool binding and `@deepseek-ai/dsh-experimental-security-analysis/ghidra` plugin are removed. GhidraMCP tokens, ports and bound GUI programs are not converted into headless configuration. Headless supports fixed read-only queries; GUI database edits have no replacement.

Tasks that depend on the removed GUI provider cannot continue through it. Create a new task using headless; no historical-task migration is provided. This change does not delete task storage.

Headless queries keep a resident process until idle expiry, eviction or explicit environment shutdown. Active project caches remain leased until that process exits; only cleanly completed projects become reusable disk caches. Optional analysis settings select separate sessions and caches.

## Migration

1. Remove the `@deepseek-ai/dsh-experimental-security-analysis/ghidra` plugin row from your `cordis.yml` or overlay, including its `programs` configuration. Remove `ghidra` from tool preferences, custom tool packs and `toolAdapters.bindings` or installation-file `bindings`.
2. In **Toolbox**, install or select **Ghidra headless** and its compatible JDK. Check the selected installation and choose its local or managed Docker environment. The installation manager saves the Java executable and fixed Ghidra launcher arguments; GUI tokens and ports are unnecessary.
3. Create a task, import the binary, enable the native binary module and call `security_ghidra_headless` with an operation such as `identity` or `functions`. Confirm that the returned evidence identifies the sample and Ghidra version. See the [setup guide](../../../../packages/experimental/security-analysis/README.md#configure-analysis-providers) for cache and process limits.
4. Set `toolAdapters.ghidraHeadless.sessionIdleTimeoutMs` and `maxSessions` for the available memory. Repeat the same `analysis` parameters for related queries. Wait for idle closure before deleting a leased cache; do not remove its lock manually while a process is alive.
