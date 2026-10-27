---
description: "Inspect child agents and tool statistics, and use terminals in the bottom research panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-research-runtime

English | [中文](README.zh.md)

## Summary

This optional plugin adds Subagents, Tool statistics and Terminal pages to the research workbench. It uses the existing conversation and terminal services and has no security-workbench or Git dependency.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Enable the [research bundle](../research-workbench-bundle/README.md) in a Web profile and select a conversation. Subagents lists direct children recorded by the selected conversation. Open conversation navigates through the existing workspace service.

Tool statistics groups loaded calls by tool name and shows counts for completion, failure and ongoing work, plus average duration when start times are available. Nested calls are counted once. New terminal explicitly starts an interactive shell in the selected conversation's working directory; End terminal requests process cleanup. Cleanup failures offer a retry.

Rich working files (Office, PDF, images, HTML and Markdown) open through the native document-preview plugin in a large movable, resizable reading window. Narrow screens use the native fullscreen reader. The bottom panel keeps the file list; the security sidebar retains its docked tab. Office conversion and spreadsheet support follow the native preview provider. Immutable security assets remain with their source adapter.

Disable loader entry `research-runtime` to remove these pages while retaining file reading and editing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

Panel contributions use `ctx.researchWorkbench.registerPanel()` and the `research.panel` slot. The registration retains the current Session and subscribes to the assembled chat source. Tool statistics derive from call and result metadata, including nested dispatches, without reading arguments or result bodies.

Terminal rendering uses the native `terminal.viewport` Factory. A separate retention owner keeps bottom-panel terminals independent of right-sidebar tabs; disposing the plugin releases its subscriptions and retention owner.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Research workbench](../research-workbench/README.md)
- [Native terminal UI](../../client/ui-sidebar-terminal/README.md)
- [Terminal controller](../../api/terminal-controller/README.md)

-----

<a id="dev-note"></a>
## Dev Note

None.

-----

<a id="model-experience"></a>
## Model Experience

### Operator inspection

#### What the model sees

Pages contributed through `research.panel` display existing records or accept operator terminal input; their contents are not automatically inserted into model requests.

#### Token effect

Viewing records and using the operator terminal add no model tokens.

#### KV Cache effect

None. This plugin does not change tool definitions or provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Statistics cover only the loaded conversation window. Ongoing work includes argument preparation. Average duration includes successful and failed results with valid recorded start times.
- Subagent rows describe recorded direct children, not inferred live process status. Bottom terminal tabs are retained during conversation switches but are not restored after a browser reload.
