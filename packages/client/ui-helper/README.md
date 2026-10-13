---
description: "Configure expert consultations and inspect per-session usage in the browser."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-helper

English | [中文](README.zh.md)

## Summary

Choose an expert model, manage native ChatGPT login, and inspect consultation results without leaving the conversation. Saving preferences makes no inference request; the separate test-chat action uses the saved configuration and consumes provider quota.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The security Web composition mounts this plugin with [Helper](../../subagent/helper/README.md). In another Web composition, mount `@deepseek-ai/dsh-client-ui-helper` together with the Helper service and existing conversation, plugin-settings and workspace services. This plugin has no configuration fields.

Open the composer Helper menu → Configure advanced model / Codex, or Plugins → Helper · Advanced model / Codex. Opening settings preserves the current chat and its Helper switch. Choose an existing API route or native Codex, select a supported reasoning effort, and save. Selecting a model prefers `high` when advertised; otherwise select an offered effort or provider default. Invalid saved choices remain visible and block testing. API credentials and custom reasoning mappings belong on the Models page.

The ChatGPT controls show public account details, open the official login link, cancel a pending login, and refresh account/model metadata. Authentication remains owned by Codex. Select a workspace before creating a test chat; it enables Helper only in that fresh chat and keeps the main model unchanged.

The composer menu controls the current session and shows persisted counts, statuses, elapsed time and token totals. Expand a Helper tool call to inspect submitted materials, advice and reported model details. API calls offer the complete child log. Missing token fields display “Not reported”; history paging and reconnects do not recalculate counts from visible cards.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The controller stages preferences through the shared settings form and refreshes independent account/model directories. Cards combine raw tool blocks with the Helper session projection, so native calls and PTC subcalls use the same persisted facts. No runtime invariant companion is published: the views derive from their owning services without a second mutable source.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Test chat

#### What the model sees

The explicit test action submits a localized user message asking the main model to call `helper` once for a read-only README heading check. The [Helper service](../../subagent/helper/README.md#model-experience) owns the tool instructions.

#### Token effect

Testing consumes one main-model turn plus the selected expert's consultation. Saving preferences sends no model request.

#### KV Cache effect

The test starts a separate session with its own request prefix and does not append to an existing work session.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The browser can show only facts supplied by the selected backend.

- Codex intermediate tool traffic has no DSH child-log view.
- Account and model directory errors require an explicit refresh or configuration repair.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
