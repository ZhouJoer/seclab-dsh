---
description: "Configure optional read-only expert consultations, per-session availability, model selection, and durable usage."
kind: "package-bundle"
---

# @deepseek-ai/dsh-helper

English | [中文](README.zh.md)

## Summary

Enable `advisor` when a fast main model needs an independent expert opinion. Each call sends an explicit question, evidence and attempted approaches to a fresh adviser, then returns its advice to the main model. Choose an existing API model or an optional local Codex backend. Consultations can consume provider quota; saving preferences does not invoke a model.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Codex consultations retain tool start and completion records in the parent Session through `subagent-codex/tool`; `helper/codex-trace` connects their native thread to the advisor call or automatic consultation. These audit records do not enter parent model messages. API consultations retain their existing child Session logs. A started item without a completion records an observation gap, not success.

The bundle mounts a disabled Advisor service. The security Web composition also mounts the [browser controls](../../client/ui-helper/README.md) and enables the [Codex consultation provider](../subagent-codex/README.md). Other profiles can install `@deepseek-ai/dsh-helper` with `dsh plugin --profile <name> add @deepseek-ai/dsh-helper` and compose the optional UI and Codex plugins explicitly.

Configure the API endpoint, key, protocol and model on the Models page. Advisor stores only the existing provider/model reference and reasoning effort. Codex uses its package-local pinned runtime and native ChatGPT credentials; set `consultation: true` on `dsh-subagent-codex` to expose its account and model methods. The initial Codex candidate is `gpt-6-astra` with `high`; the model must be advertised by the current account. No Codex dependency is added to the base bundle.

The global `enabled` and `mode` preferences apply to new top-level sessions; `mode` defaults to `normal`. `/advisor normal` and `/advisor proactive` enable the selected mode for the current session; `/advisor on` selects normal mode and `/advisor off` disables Advisor. The `/helper` command remains an alias. The session log retains the selected mode; earlier policies without a mode restore as normal. Disabling removes the next request's tool and rejects subsequent calls; use the normal Stop control to cancel an already running consultation. Model preferences are sampled once per call. Unsupported saved efforts fail without fallback. An empty effort explicitly selects the provider default; Web model selection prefers `high` when available.

API consultations use `apiMaxTokens` (default 32,768) for each analysis request. `apiRecoveryEnabled` defaults to false. When enabled, one delivery request uses `apiRecoveryReasoningEffort` (default `low`) and `apiRecoveryMaxTokens` (default 8,192). Both efforts must be supported by the selected model; unsupported recovery settings fail before inference. Codex consultations do not use these API settings.

Each call records its backend, selected/actual model, effort, terminal status, elapsed time and reported token counts. Missing usage remains absent. Codex cumulative notifications replace earlier totals, and cached input is subtracted from the DSH uncached input count. API calls link to their full child session. Statistics come from the complete projection, independently of transcript paging; inherited fork calls are excluded and unfinished restored calls become interrupted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin composes the existing subagent lifecycle without changing the loop. Its API provider applies native tool presentation, filters to available `read`, `glob`, `grep`, and `read_image`, and guards execution with the same allowlist inside the child creation transaction. Read permissions are inherited; reads are not confined to the workspace. Codex uses an ephemeral read-only thread, disabled networking and permission elevation, and disables Apps, plugins, hooks, recursive agents and every effective MCP server.

The session projection derives only from recorded policy, start and end events. A tool-call id joins its arguments and answer to the metrics, including PTC subcalls. No invariant companion is published: lifecycle ownership belongs to the subagent service and projection values are derived from their sole event source.

Host plugins can call `consultAutomatically` in an enabled proactive session. Automatic calls use `helper/auto-start` and `helper/auto-end` with a consultation ID, question, final advice and the same metrics as tool calls. They share the read-only provider execution and cancellation path. Automatic consultations cannot overlap another consultation in the same parent. Provider failures reach the caller after child cleanup; cleanup failures remain terminal.

The optional fifth argument, `ApiConsultationOptions`, selects a complete API route, reasoning effort, per-request output-token cap and `toolAccess` for that call. It leaves saved preferences and manual consultations unchanged. Omitting it uses the saved backend and read-only access. `toolAccess: 'none'` gives a fresh child only the submitted evidence, hides all tools and rejects tool execution; `'read-only'` keeps the existing read allowlist. The parent records the actual model and usage; its linked child log records the provider, model and output cap. `recovery` accepts an explicit effort and output cap; omission or `false` disables recovery even when saved manual API recovery is enabled.

Tool-free API advisers retain the inherited system policy and append a final role section: “You are a tool-free adviser for the parent agent.” The section assigns execution, skill loading, job management, progress saving and task completion to the parent, while preserving authorization, safety and evidence requirements. The child can return advice without performing those operations. A complete system prompt or assembly override that removes this section rejects the consultation before model inference; use composable prompt sections for tool-free consultations. The child log records the assembled system prompt and any terminal failure. Read-only API and Codex advisers retain their existing instructions.

An enabled delivery policy can follow a known output-limit finish or a completed response without visible text with one separate turn in the same child. The original incomplete turn remains in the log. Recovery hides and denies tools, makes one conversation request, and asks for established findings, remaining uncertainty and the next check. Only the recovery turn's completed, nonempty text can become advice; an earlier partial answer is never substituted. Provider errors, cancellation and unknown outcomes are not retried. The caller's deadline covers both turns, and reported usage sums both turns.

Host plugins can use `installOutputRecovery` for a continuing main agent. Its durable attempt record prevents repeated recovery after reload; the caller chooses one allowance for the session or one after each admitted human input. New human input withdraws an unclaimed delivery prompt. A delivery request already claimed may finish; subsequent human work uses normal request controls and tools. Human steering that shares the claimed batch takes precedence over delivery instructions.

Callers await the controller's `dispose()`. Disabling recovery cancels its active delivery turn and retains tool guards until that turn settles; unrelated queued input remains available. The Agent owns any remaining config restoration until the next normal request header commits, including a request for a different model. A failure before header persistence leaves restoration available for the next request. No synthetic request header is appended during teardown.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Expert consultation

#### What the model sees

The main model completes initial reconnaissance itself. Proactive mode asks it to run the smallest executable check before adopting a premise that excludes candidates or directs substantial work. The check must distinguish competing predictions, and its expected result or positive control must have independent support. Tool failures and empty searches do not reject an entire explanation. The `advisor` tool receives the premise, original evidence, actual check and unresolved decision. The model verifies recommended checks before changing direction and consults again only for new evidence or a materially different question. Helper does not count tool executions or strategies and does not add first-tool reminders. Other Host plugins may append logged evidence-execution notices. Normal mode retains optional expert consultation after reconnaissance.

#### Token effect

The tool description and submitted evidence consume input tokens. The tool returns complete advice or an explicit failure. Optional delivery recovery adds one input request, including available prior analysis, and its separately capped output; increasing a token cap alone does not guarantee delivery. API advisers can inspect files using the allowed tools; automatic calls with no tool access use only submitted evidence. Codex advisers may use native file-reading commands inside the enforced read-only sandbox. Neither adviser may recursively consult or apply implementation changes.

#### KV Cache effect

Each adviser has an independent request prefix. Changing its model, effort or available tools changes that prefix. The main conversation appends submitted calls and returned advice without rewriting earlier messages. Delivery recovery appends its prompt and changes that request's effort, output cap and available tools. Switching modes changes the tool description in subsequent requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Each consultation waits in the foreground. Optional delivery recovery handles only known incomplete output; it does not retry provider failures or switch backends, and it cannot guarantee a complete or correct model answer.
- Codex intermediate tool traffic is not a DSH child log. Its final advice and reported usage are retained.
- The caller supplies relevant evidence. Missing credentials, unavailable account models and provider failures remain visible errors.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
