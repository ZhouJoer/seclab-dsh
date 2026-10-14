---
kind: upgrade-guide
description: "The default job_output wait cap decreases from ten minutes to one minute."
---

# job_output wait cap

English | [中文](guide.zh.md)

## Change

`job_output(wait: true)` returns unread output immediately and wakes on new model-visible output or progress, as well as completion. Callers must inspect the returned status: a successful read does not imply that the job finished. A timed-out read explicitly reports that the background job remains running and discourages repeated unchanged waits.

The default `maxWaitTimeoutMs` for `@deepseek-ai/dsh-tool-jobs` decreases from `600000` to `60000`. A longer model-supplied `timeout_ms` now returns the current job state after at most one minute of waiting. The job continues running and retains its completion notification. The default wait when `timeout_ms` is omitted remains `30000`.

## Migration

1. Keep the new default for interactive conversations. No configuration change is required.
2. If your profile intentionally requires longer single waits, set `config.maxWaitTimeoutMs: 600000` on its `@deepseek-ai/dsh-tool-jobs` entry in `cordis.patch.yml`. Any explicit `waitTimeoutMs` must not exceed this cap.
3. Verify a long-running job returns `[status: running]` when the configured wait expires and can still be collected after completion. In-flight waits retain the configuration captured when they started.
