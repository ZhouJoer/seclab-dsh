---
kind: upgrade-guide
description: Tool installation files use a versioned environment map after saving.
---

# Security tool installation files

English | [中文](guide.zh.md)

## Change

Toolbox and CLI saves write version 1 installation files with installations and bindings fields. Readers accept the previous flat local map, but external scripts reading or writing that map must adopt the versioned format. Existing Shell history and Session data are unchanged.

## Migration

1. Keep the existing toolConfiguration.path file; no manual conversion is required. toolConfiguration.environmentId identifies its legacy local environment.
2. Update external readers to use installations[environmentId][toolId]. Each installation contains command, prefixArgs and versionArgs. Write bindings[toolId] to select the fixed environment; r2ghidra uses the radare2 binding.
3. For a custom profile, set toolAdapters.bindings explicitly and authorize those environments in the project. The shipped security profile supplies local defaults.
4. Refresh the Toolbox, check and save an installation, then run a dedicated analysis tool. Confirm that its evidence and confirmed activity count appear. Read [configuration behavior](../../../../packages/experimental/security-analysis/README.md#configure-analysis-providers) for limits and Docker ownership.
