---
kind: upgrade-guide
description: "Security analysis budgets remain closed across internal notifications until a new human request resumes exploration."
---

# Resume budget-limited security analysis with a user request

English | [中文](guide.zh.md)

## Change

Security analysis previously reset `analysisTurnTokens` whenever a turn began, so a background completion could reopen exploration after budget wrap-up. Internal continuations now retain the allowance and closed phase. After the final response, an ordinary internal notification starts no additional model request. An explicitly configured Helper output-recovery notice may request one tool-free delivery turn without reopening exploration. This affects security deployments that relied on job completion to resume a budget-limited investigation. Existing owned jobs can be collected or cancelled during wrap-up, including after saving; cleanup attempts are bounded as described in the [package README](../../../../packages/experimental/security-analysis/README.md).

Tool definitions remain visible throughout direction review and ordinary wrap-up. If finalizing stalls on a denied action, one text-only delivery request omits tools and can invalidate the cached prefix; further invalid calls are bounded without reopening exploration. The execution guard enforces phase restrictions without repeatedly replacing the tool list. Integrations must not treat schema presence as execution permission. `analysisTurnTokens` uses actual accrued usage rather than predicting another request from the latest cost. A cold resumed request below the threshold can continue exploring; a single request can overshoot it. Bounded save, cleanup and final-delivery requests still consume additional tokens.

## Migration

1. Keep existing `analysisTurnTokens` and `analysisWrapUpSteps` settings in `cordis.yml`; no key changes are required. Send a new user request to continue after budget wrap-up instead of relying on an automatic completion notification. `analysisTurnTokens: 0` disables this additional exploration limit when the deployment deliberately delegates budgeting elsewhere.
2. Host plugins scheduling analysis work can call `securityWorkbench.getAnalysisPhase(agent)` and admit exploration only when it returns `exploring`. This is live process-local state, not a persisted task-completion flag.
3. Confirm that a late job completion after wrap-up does not issue another model request, and that a new user request restores exploration permission and the allowance. Verify that denied tools cannot execute even while their definitions remain visible.
