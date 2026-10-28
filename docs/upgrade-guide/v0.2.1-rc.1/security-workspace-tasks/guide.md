---
kind: upgrade-guide
description: "Security workspace tasks use native source tools and directly submitted reports instead of automatic directory snapshots."
---

# Security workspace tasks

English | [中文](guide.zh.md)

## Change

New analysis opens a blank native conversation, inheriting workspace environments. Selecting the security preset on the home screen also creates and associates a task on first send, before any model request or tool call. Missing settings block sending and preserve the draft. Ordinary presets do not auto-create security tasks. Tasks can exist before the first user message. Their stored records can include a primary Session identity and a lightweight workspace target. Earlier builds use strict record validation and cannot read these new fields.

Custom Client ISessions implementations must provide registerPresentation() and renameDisplayTitle(). Presentation sources overlay business-owned names and reserve associated blank conversations; the original Session title remains unchanged. The project directory now includes associated sessions for exact navigation.

Task records also accept optional saved outcomes and report delivery status; report records can include a material fingerprint for reuse. The current reader accepts records lacking these fields. Older strict readers reject records written with them; keep Host and Client on the same version and restore the pre-upgrade store backup before downgrading.

Automatic recursive collection and mandatory progress checkpoints are removed. Source investigation uses native file tools. The security Web profile supplies the target workspace without injecting the local Harness implementation checkout. `complete-task` accepts analyst-authored report content and citations; the Host validates saved observations and renders the report without another model request. Historical snapshots, evidence and reports remain readable.

## Migration

1. Upgrade the Host and Client together. Existing tasks remain readable and keep their current materials; their historical conversations are not renamed.
2. Select the security preset on the home screen and send with workspace defaults, or expand **Configure** to save settings for this task. Workspace defaults change only through **Set as workspace defaults**. Cancel and restore actions keep the selected mode. **New analysis** creates an associated blank chat without sending. Restart retains task settings, tool preferences, Advisor availability and mode, and authorization expiry. URL mentions do not register targets. Workspace selections and first-message overrides use `security_workspace_intake_v2`; the previous domain remains untouched and is not imported. Reconfigure workspace defaults if needed, and update any explicit storage route to the new domain name.
3. Remove `workspaceMaterials`, `analysisProgressCalls`, `reportInputBytes`, `reportOutputTokens`, `reportMaxChars` and `reportMaxLessons` from security-workbench configuration. Keep `reportMaxFindings` for the main report size and `maxOutputBytes` for output limits. Replace custom calls to `refreshWorkspaceMaterials` with the native workspace file browser.
4. Submit report content and source locations through `complete-task`; existing `evidenceIds` remain accepted. `report` republishes a saved submission without rerunning analysis. Verify that source tasks start without a material-sync step and report citations retain their original excerpts.
5. Keep a backup of the security workbench store before upgrading. To return to an earlier build, restore that backup; do not open newly written task records with the older reader.
