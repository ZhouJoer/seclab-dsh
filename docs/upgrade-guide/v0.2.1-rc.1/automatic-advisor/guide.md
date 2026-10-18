---
kind: upgrade-guide
description: "Automatic Advisor records require a reader that recognizes the new event types."
---

# Automatic Advisor session readers

English | [中文](guide.zh.md)

## Change

Enabling the optional Jev bundle writes required automatic-consultation and assessment events. Older readers refuse sessions containing these events. Helper projection entries can now identify a consultation with `consultationId` instead of a tool `callId`. The default-disabled configuration writes no new automatic-consultation events.

## Migration

1. Upgrade session readers and SDK runtimes together before enabling the bundle. See the [persistence acknowledgement](../../../persistence-changes/2026-10-18-automatic-advisor-jev.md).
2. Consumers of `HelperState.calls` must distinguish automatic entries by `consultationId`; do not assume every consultation has a tool call.
3. Run a configured consultation and confirm the reader accepts `helper/auto-start` and `helper/auto-end` with the recorded answer.
