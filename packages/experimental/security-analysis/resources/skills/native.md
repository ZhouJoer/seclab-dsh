# Native binary analysis

This method needs reverse.native in the task's moduleSelection. Read security_capabilities first. The coordinator may update automatic selections through security_command action modules; a manual selection requires an operator adjustment. Skill invocation grants no execution permission.

Establish the imported PE/ELF/shared-library identity, architecture and relevant entry point. Use security_radare2 identity/imports/exports/strings/functions, or the configured readelf/objdump/nm adapters for the precise question. Feed saved evidenceIds to security_analysis native-triage for a located inventory. Avoid repeating collection when the retained evidence already covers the question.

To assemble native paths, save radare2 functions and relevant xrefs-to/xrefs-from evidence, then run security_analysis native-xref-paths with those evidenceIds, a hexadecimal seed, direction callers or callees, and maxDepth. Include strings/imports evidence when relevant. The analysis separates calls, jumps and data references, retains call sites and resolves source functions from explicit adapter ownership or an unambiguous recorded range. Use frontier nextOperation requests to collect missing adapter evidence and rerun with the expanded evidence set. It returns one discovery path per node, not every possible path. Indirect calls and missing function ranges stay unresolved; no target execution is implied.

Follow a relevant string or imported operation to references, a function and its callers. Use security_r2ghidra or security_ghidra for targeted decompilation. Preserve virtual addresses, file offsets and evidence IDs; do not confuse an address in a loaded process with an unrelocated image address. Imported names and strings are leads, not proof of a reachable defect. Separate observed instructions from decompiler approximations and algorithm hypotheses.

For PE address conversion or explicitly requested byte patches, use the bundled [PE helper](pe.md) before writing a parser or patch script. It uses the selected Python's pefile, accepts batches, and saves a patch manifest while returning a compact receipt. Reuse successful results for unchanged inputs and parameters; do not reread full evidence or ask another model to repeat a completed check. Recheck only changed inputs, a failed check or a concrete contradiction. When selecting replacement instructions, account for instruction boundaries, calling convention, stack effects and affected callers. Byte checks and PE checksums do not establish runtime behavior; retain that limitation without adding a mandatory execution or review stage.

For JNI, connect the native symbol or registration to Android-side callers using evidence from each asset. Do not merge findings across different builds or ABIs without an explicit link. Firmware analysis may require security-firmware and Web/IoT modules when the question crosses those components.

Use security-dynamic's existing bounded Frida templates only when a concrete unresolved hypothesis needs runtime observation. Prepare and approve the exact script and target through the workbench; do not replace that lifecycle with shell attachment or a watchdog. Findings and independent review remain in the existing evidence workflow.

Read [on-demand tool setup](bootstrap.md) only when a required dependency or operation is missing.
