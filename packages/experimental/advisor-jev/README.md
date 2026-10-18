---
description: "Opt-in Jev stagnation decisions that trigger read-only Advisor consultations."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-advisor-jev

English | [中文](README.zh.md)

## Summary

This experimental bundle assesses recent tool results with TypeSafe Jev and can invoke the configured Advisor before the next main-model request. It is disabled by default and requires the Helper service. Only enabled, proactive top-level sessions are eligible. The [subagent subsystem](../../../docs/subsystems/subagent.md) owns consultation execution.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Compose this optional bundle beside `@deepseek-ai/dsh-helper`. Configure the Helper API or Codex backend independently. Set `enabled: true` on the `advisor-jev` row and supply `apiKey` through a secret-bearing configuration expression; never commit a real key. Set the current session to `/advisor proactive`. A disabled installation sends no requests. Configuration errors fail at load.

Insert this configuration into a profile patch after installing this package and Helper in that profile; `JEV_API_KEY` is read from the launching process environment:

```yaml
- insert:
    - id: advisor-jev
      name: '@deepseek-ai/dsh-experimental-advisor-jev'
      config:
        enabled: true
        apiKey: !!js process.env.JEV_API_KEY
```

The default endpoint is the TypeSafe `systemone` API and the pinned model is `jev-1.13.0`. The first check requires three completed tool-bearing steps; subsequent checks require three additional steps. Calls within one step count once. At most one automatic consultation is started per turn. Routing requires `consult_advisor`, probability at least 0.85 and confidence at least 0.8. These experimental thresholds are configurable and have not been calibrated on production tasks.

`timeoutMs` bounds a Jev request including its response body. `maxRequestBytes` bounds the complete serialized request; `maxResponseBytes` bounds the response before parsing. `maxEvidenceCalls` and `maxFieldChars` bound retained evidence. Oversized requests report an unavailable assessment instead of silently treating missing evidence as progress. Requests are not retried and long context is not enabled. Only HTTPS endpoints and loopback HTTP fixtures are accepted; redirects are refused.

The exact bounded request, decision, usage and terminal status are logged without the credential. Automatic consultations use independent IDs and appear in Helper totals. Advice is recorded before it is admitted to the main model. Stopping a turn cancels both providers; disabling Advisor also cancels this plugin's current operation. Plugin disposal aborts and joins its outstanding work.

<a id="understand-the-implementation"></a>
## Understand the implementation

A host-only Session projection folds committed events into bounded task and call/result evidence. It counts completed tool-bearing steps, checks and automatic consultations. The pre-step waterfall delegates first and assesses only admitted continuations. Replay rebuilds progress without invoking either provider. Each new turn resets its check and consultation budget. Manual consultation resets the check interval and evidence window.

Jev receives a closed choice question separating progress, stagnation, insufficient evidence and external blockers. Its response is validated before policy evaluation. Fresh queued human input supersedes a pending decision. Jev errors add a logged notice and allow the main model to continue or consult manually. An Advisor failure with completed child cleanup likewise adds a notice; cleanup failure propagates and stops dependent work. No model-authored tool calls are fabricated.

<a id="model-experience"></a>
## Model Experience

### Automatic consultation

#### What the model sees

The main model keeps its `advisor` tool and proactive reminders. After an automatic consultation it receives the advice and a request to verify the smallest recommended step. Jev receives only the bounded evidence and routing criteria. The adviser receives that evidence with a fixed request to identify incorrect assumptions and a verifiable next step; its existing read-only restrictions apply.

#### Token effect

Each assessment sends a separate Jev request. A triggered consultation consumes the selected Advisor provider's quota, and its returned advice adds main-model input tokens. Missing token counts remain missing; Jev and Advisor usage are recorded separately.

#### KV Cache effect

The main model receives appended advice or failure notices; earlier messages are not rewritten. Jev requests and each Advisor consultation have independent context.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Evidence covers a bounded portion of the current turn; there is no long-term strategy summary or final-answer review.
- Evidence truncation can hide a decisive observation. A structured result is not evidence of accurate stagnation detection; real-task calibration is still required.
- Provider integration is tested with a local HTTP fixture. Live TypeSafe accuracy, latency and account availability require a separately configured API test.
- Configuration is profile-owned. There is no dedicated Jev settings page or automatic retry after recovery.

<a id="dev-note"></a>
### Dev Note

None.
