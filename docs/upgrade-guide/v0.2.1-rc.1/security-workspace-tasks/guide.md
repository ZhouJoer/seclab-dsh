---
kind: upgrade-guide
description: "Security workspace tasks persist a primary conversation and immutable directory material versions."
---

# Security workspace tasks

English | [中文](guide.zh.md)

## Change

New analysis opens a blank native conversation, inheriting workspace environments. Tasks can exist before the first user message. Their stored records can include a primary Session identity and a current workspace-material pointer. Earlier builds use strict record validation and cannot read these new fields.

Custom Client ISessions implementations must provide registerPresentation() and renameDisplayTitle(). Presentation sources overlay business-owned names and reserve associated blank conversations; the original Session title remains unchanged. The project directory now includes associated sessions for exact navigation.

## Migration

1. Upgrade the Host and Client together. Existing tasks remain readable and keep their current materials; their historical conversations are not renamed.
2. Use **New analysis** to create an associated native conversation. Choose its workspace environment if no default exists, then enter the objective in chat. No message is sent by creation.
3. Open the workbench through the conversation shield and check the directory-material status. Configure collection budgets through `workspaceMaterials` when needed.
4. Keep a backup of the security workbench store before upgrading. To return to an earlier build, restore that backup; do not open newly written task records with the older reader.
