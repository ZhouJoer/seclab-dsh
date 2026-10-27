---
kind: upgrade-guide
description: "Security workspace tasks persist a primary conversation and immutable directory material versions."
---

# Security workspace tasks

English | [中文](guide.zh.md)

## Change

New analysis opens a blank native conversation, inheriting workspace environments. Selecting the security preset on the home screen also creates and associates a task on first send, before any model request or tool call. Missing settings block sending and preserve the draft. Ordinary presets do not auto-create security tasks. Tasks can exist before the first user message. Their stored records can include a primary Session identity and a current workspace-material pointer. Earlier builds use strict record validation and cannot read these new fields.

Custom Client ISessions implementations must provide registerPresentation() and renameDisplayTitle(). Presentation sources overlay business-owned names and reserve associated blank conversations; the original Session title remains unchanged. The project directory now includes associated sessions for exact navigation.

## Migration

1. Upgrade the Host and Client together. Existing tasks remain readable and keep their current materials; their historical conversations are not renamed.
2. Select the security preset on the home screen and send with workspace defaults, or expand **Configure** to save settings for this task. Workspace defaults change only through **Set as workspace defaults**. Cancel and restore actions keep the selected mode. **New analysis** creates an associated blank chat without sending. Restart retains the current task's settings, including authorization expiry. URL mentions do not register targets. Workspace selections and first-message overrides use `security_workspace_intake_v2`; the previous domain remains untouched and is not imported. Reconfigure workspace defaults if needed, and update any explicit storage route to the new domain name.
3. Open the workbench through the conversation shield and check the directory-material status. Configure collection budgets through `workspaceMaterials` when needed.
4. Keep a backup of the security workbench store before upgrading. To return to an earlier build, restore that backup; do not open newly written task records with the older reader.
