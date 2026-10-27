---
description: "Read source materials, compare fixed versions and edit current work files in a collapsible research panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-research-workbench

English | [中文](README.zh.md)

## Summary

Open the Research control at the bottom of the application. Working files come from the selected conversation; security materials and runtime tools are separate optional plugins. Unsaved edits stay in this browser tab across refreshes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

`open(resource, { floating: true })` opens a large reader without requiring a conversation. A source can return complete display-only PDF or raster bytes; binary content is neither editable nor eligible for text comparison. PDF uses the optional `document.pdf` Factory.

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in a Web profile with filesystem, Session query, working-directory, sandbox-policy and the ordinary client services. Set `maxTextBytes` (default 2097152) and `maxEntries` (default 2000) in its loader configuration.

The [research bundle](../research-workbench-bundle/README.md) composes the file reader and optional runtime tools. Close a modified tab with Save, Discard or Cancel. Select source text and choose Add selection to conversation to insert an attributed quote without sending it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The `researchWorkbench` browser service registers resource adapters and panels with disposers. A single root Factory owns `research.panel` and `research.reference`, shared by `shell.bottom` and `shell.overlay`. See [adapter types](src/client/contract.ts), [view state](src/client/store.ts) and [file service](src/index.ts).

`registerPreview()` contributes an optional reader for explicit open actions. Readers return whether they handled a resource; unmatched resources and comparisons use their text adapter. Disposing a reader removes its routing without changing existing text drafts.

Reads and saves resolve the effective Session directory and canonical file target. Saves require the original root key, target key and version, then use `replaceIfVersion`; they never create a missing file. Historical resource adapters have no save operation.

File tabs use the native docking chrome. Drag a tab outside the bottom area to open a movable, resizable preview; return it using the window’s dock control. Narrow screens keep the reader in one fullscreen layer.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Architecture](../../../docs/architecture.md)
- [Security workbench](../client-ui-security-analysis/README.md)

-----

<a id="dev-note"></a>
## Dev Note

None.

-----

<a id="model-experience"></a>
## Model Experience

### Operator research

#### What the model sees

Browsing creates no model request. `research.reference` inserts an attributed selection into the operator draft; explicit submission uses existing user-message logging.

#### Token effect

Only explicitly submitted quotations occupy conversation context; reading and editing add no model tokens.

#### KV Cache effect

The plugin does not change model tool definitions or system prompts. Submitted user messages follow the existing conversation path.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only existing UTF-8 text files within the effective working directory are editable. Binary, invalid UTF-8 and mixed-newline files remain read-only. Previews marked incomplete cannot enter a complete comparison. Draft recovery depends on browser storage capacity; storage failures are shown in the panel.
