---
description: "Opt-in local research checks, source references, consultation limits, and synthetic validation."
kind: "package-reference"
---
# Local direction review

English | [中文](README.zh.md)

## Summary

Check a consequential research premise against original observations before using it to exclude candidates or expand a search. Record observations separately from interpretations, request a bounded independent review, and retain uncertainty in progress handoffs. Reviews can propose executable checks; they do not certify scientific conclusions.

This private file plugin is optional, disabled by default, and outside the published workspace packages and shipped profiles. Its directory retains the local study layout; the versioned files contain general mechanisms and synthetic tests, not task records or deployment settings.

## Table of Contents

- [Local mounting](#local-mounting)
- [Research workflow](#research-workflow)
- [Evidence and delivery](#evidence-and-delivery)
- [Limits and lifecycle](#limits-and-lifecycle)
- [Validation](#validation)
- [Known limitations](#known-limitations)

<a id="local-mounting"></a>
## Local mounting

A local deployment mounts [index.mjs](index.mjs) as a file plugin in an existing `dsh` profile. Enabling it requires `enabled: true` and an absolute `workspace`; only matching top-level main sessions are eligible. The profile must supply the injected services and the configured model route. Keep deployment-specific profiles, credentials and workspace paths outside version control. The private manifest is not an npm installation target or a workspace member.

[link-local-dependencies.ps1](link-local-dependencies.ps1) links this checkout’s built dependencies on Windows. It verifies existing junction targets and refuses conflicting entries. Dependency links remain local. [delivery.mjs](delivery.mjs) is a separate optional main-output limit and recovery plugin; [its reference](delivery.README.md) describes that policy. Neither entry launches an application directly.

The validated `Config` exports in the entry modules own available settings and defaults. Review routes, reasoning effort, output limits, source-byte limits, tool categories and consultation budgets are configurable. Enabling a route does not provide credentials or permission to send private material.

<a id="research-workflow"></a>
## Research workflow

Run a small distinguishing check directly. Ordinary observations, installation commands, directory operations and tool counts do not themselves require an Advisor. When a subsequent operation adopts a premise, register `pendingDecision` together with `dependentOperation: {name, arguments}` using `premise_check save` or `submit`. Only that exact registered operation is gated. Different registered operations retain separate decisions.

`save` records progress using observations, interpretation and the next check. `prepare` previews the same record but does not save it. `submit` records two explanations, their predicted outcomes and an executed check. A normal checkpoint without an operation binding is an unverified handoff. A saved receipt, a model’s supported assessment and a completed tool call do not establish scientific validity.

By default, automatic review targets an experiment’s public interpretation when it is about to guide a subsequent configured operation. The packet contains reconstructable producer code, actual output, the interpretation and the next operation. `automaticInterpretationSignals` defaults to `[]`, so eligibility does not depend on fixed words; only an explicitly nonempty list filters candidates by wording. The optional `before-execution` stage reviews eligible generated scripts before execution. A trailing `Out-String -Width` with a positive integer preserves producer association as formatting metadata; it does not certify the measurement.

A concrete `check-required`, `insufficient-evidence` or proposal-only result blocks the reviewed operation. Independent checks and unrelated observations continue through normal permissions. Automatic coverage gaps caused by limits or incomplete delivery remain `unreviewed` and allow ordinary unregistered operations; known concerns and explicit registrations retain their stricter gates. A suggestion cannot bypass another operation’s registration.

<a id="evidence-and-delivery"></a>
## Evidence and delivery

Original tool results receive a compact logged source handle. `callId`, result sequence and workbench evidence IDs resolve to actual recorded calls; locator arguments are untrusted navigation data. `inspect` is optional and exposes reference diagnostics without another model request or copying full outputs. Invalid references retain explicit diagnostics and cannot become completed evidence.

Execution receipts describe host-observed completion, exit status, cancellation, timeout and output completeness. A process exiting successfully does not establish that every substep or measurement was valid. Failed, truncated, spilled or unavailable sources keep their limitations. An experiment executed in the current user request may retrieve an earlier native observation only when its producer explicitly references the same asset ID or an unambiguous absolute path in a trusted asset mapping. These sources are marked `previous-request`; they neither inherit an earlier review’s permission nor establish that input files remain unchanged.

Reviews accept one complete JSON object or one complete JSON code block followed by ordinary explanation. Multiple candidates, truncation, missing required fields and invalid references cannot be silently repaired into success. A usable proposed check remains advice until executed and assessed.

Final handoff review checks the certainty of the public answer. Source retrieval matches named numeric fields as well as explicit references and literals, and gives recent checks priority over older literal matches within the packet budget; a matching label and number select material without validating the claim. The host preserves the original answer and appends a source-linked correction or an explicit unreviewed notice when required. It does not ask the main model to copy the correction and does not run another experiment. Completion review separately checks a completion declaration against the original objective before saving it.

<a id="limits-and-lifecycle"></a>
## Limits and lifecycle

Consultations share a per-user-request count, token reservation, interval and cancellation owner. Internal recovery does not reset spending. New human requests reset their allowance; steering changes eligible evidence without erasing already incurred cost. Final handoff reserves consultation capacity, but reservation does not guarantee successful delivery. Unknown usage is conservatively charged against the reservation, not reported as a confirmed bill.

The Advisor has no tools. Closing and finalizing prohibit new research consultations while allowing the designated handoff flow. Cancellation, new user input and plugin disposal stop owned work and prevent late advice from authorizing an old operation or writing an old correction. Deduplication uses recorded user requests, source versions, decisions and results.

<a id="validation"></a>
## Validation

From the repository root, run the synthetic suite:

```sh
pnpm run test:local-direction-review
```

The dedicated configuration resolves workspace source imports and runs real Cordis Loader, AgentLoop and Helper compositions with model and execution fixtures. The blocking CI coverage and plain-unit aggregates include this command; running it does not contact a model provider or activate the plugin in a user profile. Test artifacts stay ignored.

The `.mjs` implementation and these separately configured tests are not included in the repository’s TypeScript build or package-source coverage thresholds. A passing build is not type-check evidence for this plugin. Deployment must additionally verify built dependency resolution and the selected profile; provider efficacy requires a separately authorized real-model evaluation.

<a id="known-limitations"></a>
## Known limitations

The plugin does not infer every implicit premise, parse arbitrary shell programs or observe unlogged file changes. Configured interpretation signals and exact-operation matching can miss semantic equivalents. Source selection and valid JSON do not establish that an experiment or its interpretation is correct. Synthetic tests measure mechanism behavior, not solved research tasks.

Version control admits only explicitly listed source, test and documentation files. Local profiles, verification reports, study logs, raw sessions, credentials, generated artifacts and dependency links remain ignored. Do not force-add them.

## Dev Note

None.
