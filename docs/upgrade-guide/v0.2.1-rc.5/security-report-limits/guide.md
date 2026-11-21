---
kind: upgrade-guide
description: "Host extensions read security report limits directly from the controller options."
---

# Read report limits from the controller options

English | [中文](guide.zh.md)

## Change

Host extensions that use `SecurityController.options.reportLimits` now read `reportMaxFindings` and `maxOutputBytes` directly from `options`. These are also the existing deployment configuration keys.

## Migration

1. Replace `options.reportLimits.maxFindings` with `options.reportMaxFindings` and `options.reportLimits.outputBytes` with `options.maxOutputBytes`.
2. If your extension constructs controller options, supply both numeric limits. Type-check the extension and publish a report with its configured limits.
