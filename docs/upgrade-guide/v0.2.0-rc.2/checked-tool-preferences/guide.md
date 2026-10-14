---
kind: upgrade-guide
description: "Security tool preferences check adapters before saving and disable native Shell execution."
---

# Checked tool preferences

English | [中文](guide.zh.md)

## Change

Applying nonempty security tool preferences checks the selected adapters, execution routes and installed dependencies before saving. The service rejects selections with missing adapters, unavailable providers or failed checks. The preference editor then restores automatic selection and displays the reason; neither failed checks nor unsaved edits block starting analysis. Ghidra readiness depends on an imported program and cannot be checked by this preference control. Sample and device access remain operation-specific checks.

While a selection is active, `bash`, `pwsh` and native workflow discovery are disabled. The model receives adapter names and operations directly. `toolPreferences` now returns a Promise to same-process callers; the Remote response fields are unchanged.

PowerShell commands preserve a final failed native program's exit code, including signed Windows loader statuses, instead of collapsing it to `1`. Text renderers and terminal cards accept negative exit codes and report common DLL loader failures.

## Migration

1. Configure installation paths, launch arguments and adapter environment bindings in tool settings, then apply your selection again.
2. Use **Restore automatic selection** for workflows requiring general Shell commands or tools without a checkable adapter.
3. Await same-process `toolPreferences` calls. Treat every nonzero Shell exit code as failure; do not compare only against `1`.
