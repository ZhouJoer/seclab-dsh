---
description: "Advisor diagnostic value, proactive consultation, waiting cost, and follow-up evaluation in reverse-engineering experiments."
---

# Advisor experimental evaluation report

English | [中文](advisor-evaluation-2026-10-15.zh.md)

## Summary

Advisor experiments show clear diagnostic value: when the main model keeps working from an incorrect assumption, a stronger model can independently check the evidence and propose a verifiable correction. The main limitations are unreliable proactive consultation, variable waiting time, and insufficient separation between a breakthrough and task completion.

Advisor's main value is expert review at critical points. Prioritize invocation timing, evidence handoff, and acceptance criteria, then evaluate time and cost gains in experiments with consistent conditions.

Evaluation date: October 15, 2026. Advisor in this report means the advanced-model consultation feature exposed by DSH through the `helper` tool.

## Table of Contents

- [Role and operation](#operation)
- [Key experimental observations](#observations)
- [Waiting time and interaction cost](#latency)
- [Cost and acceptance criteria](#acceptance)
- [Relationship to existing Advisor designs](#comparison)
- [Improvement priorities](#priorities)
- [Further evaluation](#evaluation)
- [Sources](#sources)
- [Dev Note](#dev-note)

<a id="operation"></a>
## Role and operation

Advisor fits long tasks: the main model executes the work, while the advisor checks important judgments, explains repeated failures, and proposes the next validation step. After receiving advice, the main model still executes, verifies, and delivers the result.

Enabling Helper exposes a consultation tool to the main model. The main model decides whether to call it based primarily on the tool description; no program rule invokes it automatically after a failure count or period without progress. Submitted material includes the reason for consultation, a self-contained question, and optional evidence and attempted approaches. Each consultation creates fresh advisor context without copying the main conversation history.

The API backend runs in a DSH child session, with tools restricted to available file reading, file discovery, content search, and image reading. It uses the parent agent's preset, and its context may also include other system instructions and dynamic information from that preset. The Codex backend uses a temporary read-only thread with native reading capabilities. Both routes return advice for the main model to implement; the main model waits in the foreground.

The implementation has no Helper-specific exploration-round limit, total waiting budget, or fixed response format. Consultation duration depends on reasoning, file reading, multiple requests, and backend overhead.

<a id="observations"></a>
## Key experimental observations

### Independent review can correct false assumptions

The experimental task combined unpacking a customized UPX executable, analyzing encrypted resource formats, and restoring HTTP pages. The main challenges were recognizing modified format fields, interpreting binary data accurately, and selecting useful validation steps.

In one run, the main model was still working on unpacking after accumulating about 24.5M tokens. After a human prompted it to consult an advanced model, unpacking and subsequent resource recovery progressed. In another run, the main model completed unpacking independently, repeatedly attempted resource decryption, and then received a critical human hint. Both cases involved continued attempts based on incorrect assumptions. [Experiment notes](https://github.com/ZhouJoer/note-gen-sync/blob/main/%E7%BB%93%E6%9E%9C.md)

One consultation provided a directly traceable connection between advice and subsequent execution. The advisor reread the file and found 190 resource entries, whereas the main model had been using 63. The advisor requested validation inputs constructed from the original file bytes. After applying the correction, the main model immediately decrypted the manifest and continued recovering resources. The advisor's direct contribution was correcting an inaccurate record that had become an assumed fact.

Another consultation recommended checking plausible plaintext separately from authentication success, helping the main model narrow the failure causes. Manifest plaintext recovery followed. The advisor provided a test that better distinguished possible causes, while the main model remained responsible for export and validation.

### Proactive consultation was infrequent; human reminders prompted calls

Several runs continued guessing fields, trying combinations, or rechecking the environment while Helper was available, until the user explicitly requested an advanced model. Some runs invoked it after another reminder that consultation was available when needed. Human reminders were the main way consultation began in these runs.

The experiment notes also describe the main model delegating reverse-engineering subtasks without invoking Helper. Ordinary subagent delegation distributes work, while Helper provides advanced-model consultation through a separate invocation entry point.

### The tool environment caused substantial unproductive work

Sessions searched for alternative installation methods despite existing local tools, selected executables with missing dependencies, waited for installations, and repeatedly checked unavailable runtime environments. Clarifying local tool locations, fixing adapters, and organizing project assets visibly reduced early exploration in some runs.

One session total was 18.5M tokens. The run combined human prompts, advisor consultation, and adjusted tool and asset configuration. Its result reflects workflow performance under these combined conditions.

<a id="latency"></a>
## Waiting time and interaction cost

Consultation latency varied substantially and affected users' willingness to keep waiting.

| Consultation | Observed wait | Subsequent result |
| --- | --- | --- |
| API consultation stopped by the user | About 414 seconds in the experiment notes | The user stopped waiting, then switched advisor backends and continued the task |
| Later Codex consultation to recheck fields | 233.2 seconds on the invocation card | Corrected assumptions including the entry count; the main model then decrypted the manifest |
| Another successful consultation | 802.4 seconds in invocation statistics | Proposed a new diagnostic method; manifest recovery progressed afterward |

Waiting time includes advisor reasoning, file reading, multiple model requests, and backend overhead. These samples differ in submitted questions, model configuration, and task stage. Further evaluation can measure each backend using the same input.

After the API consultation stopped, the session continued with Codex and ultimately reported authenticated decryption of 190 resources. Evaluation records consultation return status, advice effectiveness, and task completion stage separately.

When consultation runs in the foreground, users need to see its current stage and elapsed time and be able to cancel. A practical design would provide configurable quick diagnosis and in-depth review modes: the former focuses on supplied evidence, while the latter allows targeted additional reading. Both should have explicit time, token, or exploration-round budgets.

<a id="acceptance"></a>
## Cost and acceptance criteria

### Token usage and cost accounting

The experiments involved DeepSeek-V41-Flash, GLM-5.3-Flash, and different advanced-model backends. Session totals include requests made during human corrections, tool configuration improvements, asset organization, interruptions, and resumed work.

At review time, the relevant sessions showed cache hit rates of about 95% to 97%. Cumulative token counts include context submitted repeatedly. Cost evaluation requires separate main-model and advisor input, cache-hit, and output usage, calculated at each model's prices.

Some local sessions continued after the experiment notes were recorded, changing their cumulative usage and completion status. Future comparisons should fix an observation cutoff and distinguish usage before the first useful breakthrough, consultation usage itself, and total usage before acceptance.

### Completion needs verifiable stages

The records use “complete” for different levels of outcome. Reports and the interface need to distinguish:

1. The service executable has been unpacked and is available for further static analysis.

2. Manifest plaintext has been recovered and resource records can be parsed.

3. All resources have been exported and checked for count, length, format, or decompression.

4. Cryptographic authentication tags have been verified.

5. Static pages can be accessed over HTTP.

6. The original service runs correctly, with dynamic templates and interface behavior verified.

Some runs exported all 190 resources and returned a successful static HTTP response, with authentication-tag verification and operation of the original ARM service still pending. Another run recorded authenticated decryption of all resources. Resource export, authentication verification, static access, and original-service operation correspond to separate completion stages.

In a later run, the main model recovered manifest plaintext after the advisor returned advice, with full resource export still pending. The session total had reached 41.9M tokens. The progress in that run was manifest recovery.

In another session, after the user challenged its claim, the main model admitted that it had described already-readable plaintext header fields as decrypted results. Advisor is therefore useful not only when work stalls, but also for checking evidence and acceptance scope before the main model declares completion.

<a id="comparison"></a>
## Relationship to existing Advisor designs

Claude Code's official documentation positions Advisor as a second opinion at important points such as choosing an approach, addressing repeated failures, and checking completion. Its main model also decides when to invoke the advisor, but the advisor receives the entire conversation, including tool calls and results. DSH Helper instead receives the question and evidence assembled by the main model for that consultation; its API route also permits limited file reading. [Claude Code Advisor documentation](https://code.claude.com/docs/en/advisor)

The context approaches have different tradeoffs. Full history preserves failed attempts but adds input volume. A question summary is more compact but may present the main model's incorrect judgment as an established fact. The entry-count correction demonstrates why the advisor needs access to critical original evidence and why submissions should separate observations, unverified interpretations, and the question requiring judgment.

<a id="priorities"></a>
## Improvement priorities

### Improve consultation reliability first

The main model's system prompt should explicitly identify situations that warrant consultation: different attempts at the same obstacle produce no progress; the next action would repeat a failed method without new evidence; observations conflict with prior conclusions; or the model is about to declare a blocker or completion while an important judgment remains unverified.

Automatic escalation can use configurable stagnation checkpoints to require Helper expert review when conditions are met and record the reason. Track ordinary subagent delegation and Helper consultation separately.

The following main-model guidance can serve as a starting point for further experiments:

> When Advisor is available, request expert review after two materially different attempts at the same obstacle produce no new evidence, or when the next action would only repeat a failed method. Submit the objective, original evidence, attempted methods, and results, separating confirmed facts from current hypotheses. When assessing a route's feasibility, list the failure causes and additional evidence needed. After receiving advice, execute the smallest useful validation first, use its result to decide whether to continue, and update task status.

“Two” is a trial parameter to validate and adjust using false-trigger frequency, stagnation duration, and task results.

### Prioritize correction of judgments

Submissions should include a clear decision question, necessary original evidence, failure records, environment constraints, and acceptance criteria. The advisor should identify the assumption most worth checking, then propose a minimal test that distinguishes possible causes. If more material is needed, it should name the missing evidence.

The API advisor could use a dedicated, concise prompt composition focused on task instructions, access constraints, and workspace information needed for read-only consultation. Responses should organize the conclusion, evidence, minimal validation, expected result, and unresolved questions, and end the consultation after providing actionable advice.

### Make tool configuration a stable input

Provide the main model with verified tool paths, capabilities, dependency status, and applicable environments. Prefer configured, working tools and add alternatives as the task requires. Return a specific diagnosis when validation fails so the model can correct paths, add dependencies, or switch tools.

### Connect advice to recorded outcomes

The current successful-advisor status means that the consultation ended normally. Add records for advice execution, minimal validation results, new evidence, and task completion stage, and update blocker status based on the latest progress.

<a id="evaluation"></a>
## Further evaluation

The next round should fix task files, tool installations, asset configuration, the main model, reasoning effort, and acceptance criteria; isolate previous artifacts; and repeat runs under the same conditions. Compare no advisor, model-initiated consultation, explicit trigger prompts, and program checkpoints. Separately compare advisor backends using the same question and evidence to assess latency and advice quality.

Primary measures should include:

- **Timeliness:** time and steps from repeated failure to consultation, and whether a human reminder was needed.

- **Advice effectiveness:** whether the advisor found a new fact or incorrect assumption, and whether execution produced verifiable progress.

- **Complete delivery:** verification results and corresponding artifacts against staged acceptance criteria.

- **Waiting and interruption:** consultation duration, cancellation rate, and time from returned advice to the next useful progress.

- **End-to-end cost:** separate main-model and advisor input, cached input, output, and actual charges, interpreted alongside task completion.

The next round will focus on repeated-attempt counts, human-correction counts, and delivery quality. Its results will guide default trigger policies, budgets, and model combinations.

<a id="sources"></a>
## Sources

- [Experiment notes](https://github.com/ZhouJoer/note-gen-sync/blob/main/%E7%BB%93%E6%9E%9C.md): task setup, model combinations, stage usage, and human observations.

- [Local experiment workbench](http://127.0.0.1:3081/): existing session results, human interventions, and Helper invocation cards read on October 15, 2026.

- Local implementation: [packages/subagent/helper/src/index.ts](../../packages/subagent/helper/src/index.ts), [packages/subagent/subagent/src/child-agent.ts](../../packages/subagent/subagent/src/child-agent.ts), and [packages/client/ui-helper/src/client/HelperUsage.tsx](../../packages/client/ui-helper/src/client/HelperUsage.tsx), used to check invocation, context, tool restrictions, and statistical meaning. The experiments used different builds and configurations.

- [Official Claude Code Advisor documentation](https://code.claude.com/docs/en/advisor): used to explain differences in product role and context handling.

<a id="dev-note"></a>
## Dev Note

Experimental observations cover the period through October 15, 2026. Follow-up work focuses on consultation triggers, consultation budgets, evidence handoff, and acceptance criteria.
