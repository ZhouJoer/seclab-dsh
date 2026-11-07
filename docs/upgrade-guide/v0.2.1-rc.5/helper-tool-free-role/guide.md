---
kind: upgrade-guide
description: "Tool-free Helper API consultations reject system-prompt overrides that remove the required advisory role."
---

# Preserve the tool-free Helper role in composed system prompts

English | [中文](guide.zh.md)

## Change

Host plugins calling `helper.consultAutomatically` with `toolAccess: 'none'` previously relied on user-role advisory instructions while inheriting the deployment's system prompt. These calls now preserve that policy and append a final system section assigning execution and task completion to the parent. If a complete prompt or assembly override removes that section, the consultation fails before model inference and releases its child. Read-only API consultations, manual Advisor calls and Codex consultations are unchanged.

## Migration

1. Inspect the prompt contributions effective for tool-free API children. In an applicable `@deepseek-ai/dsh-persona` row in `agent.cordis.yml`, set `config.complete: false` and retain the required policy in `config.prefix` or `config.suffix`. For custom `systemPrompt.section()` registrations, remove `complete: true` while retaining their text. Keep custom `system-prompt/assemble` listeners cooperative and preserve the Helper role section.
2. If the deployment requires an exact complete prompt, stop requesting tool-free consultations under that configuration. Do not remove authorization or safety policy to make the consultation run.
3. Confirm that a tool-free child's recorded `system/message` retains the deployment policy and ends with the section headed `Advisor role for this consultation`. Its request still has no tools. A conflicting configuration records a failed child turn with `Tool-free Advisor requires its final system role` and an error status in the parent's `helper/auto-end` event; it sends no inference request. See the [Helper README](../../../../packages/subagent/helper/README.md) for consultation behavior.
