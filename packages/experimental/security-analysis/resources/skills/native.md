# Native binary analysis

This method needs reverse.native in the task's moduleSelection. Read security_capabilities first. The coordinator may update automatic selections through security_command action modules; a manual selection requires an operator adjustment. Skill invocation grants no execution permission.

Establish the imported PE/ELF/shared-library identity, architecture and relevant entry point. Use security_radare2 identity/imports/exports/strings/functions, or the configured readelf/objdump/nm adapters for the precise question. Feed saved evidenceIds to security_analysis native-triage for a located inventory. Avoid repeating collection when the retained evidence already covers the question.

Follow a relevant string or imported operation to references, a function and its callers. Use security_r2ghidra or security_ghidra for targeted decompilation. Preserve virtual addresses, file offsets and evidence IDs; do not confuse an address in a loaded process with an unrelocated image address. Imported names and strings are leads, not proof of a reachable defect. Separate observed instructions from decompiler approximations and algorithm hypotheses.

For JNI, connect the native symbol or registration to Android-side callers using evidence from each asset. Do not merge findings across different builds or ABIs without an explicit link. Firmware analysis may require security-firmware and Web/IoT modules when the question crosses those components.

Use security-dynamic's existing bounded Frida templates only when a concrete unresolved hypothesis needs runtime observation. Prepare and approve the exact script and target through the workbench; do not replace that lifecycle with shell attachment or a watchdog. Findings and independent review remain in the existing evidence workflow.

Read [on-demand tool setup](bootstrap.md) only when a required dependency or operation is missing.
