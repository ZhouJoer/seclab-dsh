---
kind: upgrade-guide
description: "Security profile coordinators must resolve a check with evidence or record a change of direction when exploration stalls across scheduled reviews."
---

# Resuming experiments after a second investigation review

English | [中文](guide.zh.md)

## Change

Security profile coordinators could previously continue calling exploration tools after every direction review. If two scheduled reviews in a turn see neither new complete evidence supporting a finished check nor a changed direction, the coordinator can inspect saved evidence, consult the advisor, manage jobs, submit commands, discover capabilities and environments, and load skills. Discovery and module selection do not establish progress. This also affects SDK clients replaying tool calls against the security profile.

## Migration

1. When a method is missing, use `security_capabilities`, `security_environment` and `skill` to inspect available options under existing permissions. Read the current revision and open checks with `security_scope`. If an existing observation resolves a criterion, use `security_command` action `finish` with its evidence ID and rationale. Failed or incomplete observations do not qualify.
2. If the criterion remains open, submit a changed `checkpoint`. Put the observed result or an untested control in `summary`, competing predictions in `reason`, and the test that distinguishes them in `next`.
3. Confirm the next model step offers the project's exploration tools within its remaining budget. On a later turn, inspect the saved direction and open check before resuming.
