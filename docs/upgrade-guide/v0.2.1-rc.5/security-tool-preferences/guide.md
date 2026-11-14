---
kind: upgrade-guide
description: "Checked security tool preferences prioritize selected adapters instead of disabling auxiliary Shell execution."
---

# Keep tool preferences while using auxiliary Shell work

English | [中文](guide.zh.md)

## Change

Nonempty security tool preferences previously disabled `bash`, `pwsh` and native workflow discovery. They now prioritize selected adapters for supported analysis operations while allowing auxiliary Shell work under the existing role, module, task, sandbox and approval rules. The assistant must report an adapter failure or coverage gap before using another method; it cannot silently change the selected executable or environment.

Applying preferences still checks adapters, execution routes and installed dependencies before saving. A failed check displays its reason and preserves the previously applied selection. Unsaved edits do not change active settings. Saved preferences survive Host restart and pass to delegated children. Checks and preferences grant no execution authority or sample/device readiness.

## Migration

1. Keep your saved selection when auxiliary file inspection, calculations or uncovered operations need Shell. Clearing preferences is no longer required for those actions.
2. After a failed save, correct the reported installation or selection and apply again. Use **Restore automatic selection** only when you want to clear the preference.
3. Confirm that the assistant uses the selected adapter for supported analysis and reports any failed or unsupported operation before choosing another method. Existing task restrictions and approval requirements still apply.
