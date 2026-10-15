---
kind: upgrade-guide
description: "The advisor tool replaces helper in model-facing tool calls."
---

# Use advisor for expert consultations

English | [中文](guide.zh.md)

## Change

The model-facing `helper` tool is named `advisor`. The Web controls use Advisor and offer normal and proactive modes. Prompts and scripts that explicitly name the old tool need the new name. Existing consultation records remain readable.

## Migration

1. Replace `helper` with `advisor` in prompts and tool calls that request an expert consultation. Tool arguments are unchanged.
2. Use `/advisor normal`, `/advisor proactive` or `/advisor off` to select the current chat policy. `/advisor on` selects normal mode; `/helper` remains a command alias. Keep existing `helper` configuration keys and package references.
3. Open the Web Advisor menu and select a mode. Confirm that the next model request exposes `advisor` and that previous consultation cards remain visible.
