---
kind: upgrade-guide
description: "Helper API consultations have an explicit output limit and reject incomplete answers."
---

# Configure Helper API output and delivery recovery

English | [中文](guide.zh.md)

## Change

Manual API consultations now use `apiMaxTokens` (default 32768), including provider-counted reasoning, instead of the model's full output allowance. A truncated or completed empty answer fails the consultation. The main model no longer receives a consultation reminder after its first tool result. Proactive guidance asks for a concrete unresolved question after an executable check.

## Migration

1. In the `@deepseek-ai/dsh-helper` row of your profile's `cordis.patch.yml`, set `apiMaxTokens` to the required supported output allowance. Review any caller that treated partial text as a completed answer.
2. To permit one tool-free delivery request after an output-limit finish or an empty completion, set `apiRecoveryEnabled: true`, `apiRecoveryReasoningEffort` to an effort supported by the selected model, and `apiRecoveryMaxTokens` to its delivery allowance. Defaults are `false`, `low` and 8192. Recovery uses the available evidence and cannot execute proposed checks. It does not retry network errors, refusals, cancellations or unknown outcomes. Automatic callers configure their own `ApiConsultationOptions.recovery`; omission disables recovery for that call.
3. Confirm that a truncated analysis retains its original failed turn. If recovery runs, the child Session contains a `helper-output-recovery` notice and at most one delivery request without tools. Only a completed nonempty delivery can complete the consultation; a second incomplete answer remains an error. Consultations without a usable answer must not establish a verified conclusion. See the [Helper README](../../../../packages/subagent/helper/README.md).
