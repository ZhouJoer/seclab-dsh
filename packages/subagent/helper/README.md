---
description: "Configure optional read-only expert consultations, per-session availability, model selection, and durable usage."
kind: "package-bundle"
---

# @deepseek-ai/dsh-helper

English | [中文](README.zh.md)

## Summary

Enable `helper` when a fast main model needs an independent expert opinion. Each call sends an explicit question, evidence and attempted approaches to a fresh adviser, then returns its advice to the main model. Choose an existing API model or an optional local Codex backend. Consultations can consume provider quota; saving preferences does not invoke a model.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The bundle mounts a disabled Helper service. The security Web composition also mounts the [browser controls](../../client/ui-helper/README.md) and enables the [Codex consultation provider](../subagent-codex/README.md). Other profiles can install `@deepseek-ai/dsh-helper` with `dsh plugin --profile <name> add @deepseek-ai/dsh-helper` and compose the optional UI and Codex plugins explicitly.

Configure the API endpoint, key, protocol and model on the Models page. Helper stores only the existing provider/model reference and reasoning effort. Codex uses its package-local pinned runtime and native ChatGPT credentials; set `consultation: true` on `dsh-subagent-codex` to expose its account and model methods. The initial Codex candidate is `gpt-6-astra` with `high`; the model must be advertised by the current account. No Codex dependency is added to the base bundle.

The global `enabled` preference applies to new top-level sessions. `/helper on` and `/helper off` persist a current-session override. Disabling removes the next request's tool and rejects subsequent calls; use the normal Stop control to cancel an already running consultation. Model preferences are sampled once per call. Unsupported saved efforts fail without fallback. An empty effort explicitly selects the provider default; Web model selection prefers `high` when available.

Each call records its backend, selected/actual model, effort, terminal status, elapsed time and reported token counts. Missing usage remains absent. Codex cumulative notifications replace earlier totals, and cached input is subtracted from the DSH uncached input count. API calls link to their full child session. Statistics come from the complete projection, independently of transcript paging; inherited fork calls are excluded and unfinished restored calls become interrupted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin composes the existing subagent lifecycle without changing the loop. Its API provider applies native tool presentation, filters to available `read`, `glob`, `grep`, and `read_image`, and guards execution with the same allowlist inside the child creation transaction. Read permissions are inherited; reads are not confined to the workspace. Codex uses an ephemeral read-only thread, disabled networking and permission elevation, and disables Apps, plugins, hooks, recursive agents and every effective MCP server.

The session projection derives only from recorded policy, start and end events. A tool-call id joins its arguments and answer to the metrics, including PTC subcalls. No invariant companion is published: lifecycle ownership belongs to the subagent service and projection values are derived from their sole event source.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Expert consultation

#### What the model sees

When enabled, `helper` instructs the main model to consult proactively after three materially different attempts at the same obstacle produce no new evidence or progress, before another attempt or declaring the task blocked. The main model assesses these attempts from the task context and calls without waiting for a user reminder. It supplies the reason, a self-contained question, evidence, attempted approaches and observed results, distinguishing facts from assumptions. After receiving advice, it verifies the smallest recommended step and continues the task; new evidence or a new question can warrant another consultation. The adviser receives only the submitted materials and its read-only instructions, not a copy of the main conversation.

#### Token effect

The tool returns the expert's final text or an explicit failure. API advisers can inspect files using the allowed tools. Codex advisers may use native file-reading commands inside the enforced read-only sandbox. Neither adviser may recursively consult or apply implementation changes.

#### KV Cache effect

Each adviser has an independent request prefix. Changing its model, effort or available tools changes that prefix; the main conversation only appends the submitted call and returned advice.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Each consultation waits in the foreground; no automatic retries or backend failover are performed.
- Codex intermediate tool traffic is not a DSH child log. Its final advice and reported usage are retained.
- The caller supplies relevant evidence. Missing credentials, unavailable account models and provider failures remain visible errors.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
