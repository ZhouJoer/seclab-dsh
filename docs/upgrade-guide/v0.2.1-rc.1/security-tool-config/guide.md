---
kind: upgrade-guide
description: "Security tool commands now honor existing Harness-home installations."
---

# Security tool configuration selection

English | [中文](guide.zh.md)

## Change

When the checkout has no `.dsh/security-tools.json`, `security:tools` and `security:doctor` now use an existing `$DSH_HOME/security/tools.json`, matching the security profile. Previously the commands selected only the checkout file. Tool definitions and environment declarations remain in the checkout `.dsh` directory unless explicitly overridden.

## Migration

1. Run `pnpm security:tools list` and check the reported configuration path before saving installations.
2. To keep a separate file, pass `--config FILE`; set the profile’s `toolConfiguration.path` to the same absolute path. Explicit configuration also selects its directory for default sibling definition files.
3. To provision Python dependencies, follow the [security guide](../../../user/guide/security-analysis.md). Run `pnpm security:doctor python unicorn capstone pefile r2pipe frida` and confirm the interpreter and configuration paths.
