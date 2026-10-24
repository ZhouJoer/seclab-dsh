# Reporting workflow playbook

Use after testing, or throughout an engagement to keep evidence report-ready. Reports are host-side deliverables written into the analysis directory, assembled in bounded sections rather than one write.

## Inputs

Authorized scope and test dates; confirmed findings, saved raw output, captured requests and responses, and notes; required report format and audience.

## Workflow

1. **Executive summary.** A one- to two-page non-technical narrative written first: engagement scope, methodology, key risk themes, counts of critical and high findings, and overall posture — framed in business impact (data exposure, service disruption, regulatory consequence) so it stands alone for leadership.
2. **Normalize evidence.** Group evidence by finding, affected asset, severity and proof from the saved outputs; keep raw tool output separate from analyst conclusions, and reference evidence records and captured-call identities rather than restating files.
3. **Validate findings.** Every finding carries reproducible evidence — exact commands and their actual output; remove duplicates, mark false positives explicitly, and add manual or second-tool validation for tool-only findings. Every tested service and every tool run has a finding or an explicit negative-result entry; negative results are evidence that testing happened.
4. **Assign severity.** Rate impact and likelihood in context with exploitability, authentication requirements, exposure and compensating controls. Use CVSS v4.0 base metrics as the default (v3.1 where the audience's databases require it), apply environmental and temporal adjustments where the deployment context is known, and map to compliance frameworks (PCI DSS, SOC 2, HIPAA) where relevant.
5. **Write findings.** Title, severity, affected assets, impact, evidence references, reproduction steps and remediation per finding; no unsupported claims; limitations stated.
6. **Supporting artifacts and remediation.** Collect multi-source evidence (scanner outputs, target-host material, pivot-host outputs, local captures) into the report bundle with an index. Order remediation by severity times ease times business impact; group findings sharing a root cause; separate quick wins from architectural changes; note remediation dependencies. Screenshots and format conversion through registered tooling where the environment provides it.
7. **Peer review.** Before delivery: technical accuracy, reproducibility of each finding from its documented steps, sensitive-data redaction (no live credentials, tokens or PII in body or evidence), severity consistency across the report, and narrative quality.
8. **Final review.** Scope alignment, command-log accuracy, artifact references, meaningful negative results and unreachable-target notes included; delivery through the agreed channel with immediate notification for critical and high findings and a documented retest plan.

## Cross-references

Every scenario playbook ends here; the security-review workflow (suspected finding, independent reviewer, verdict) remains the confirmation path for individual findings before they enter the report as confirmed.

## Expected evidence

The final report with executive summary and per-finding detail; the evidence bundle index; command-log summary; remediation summary with priorities.

## Stop when

Every confirmed finding has evidence and remediation; scope, limitations and residual risks are documented; the operator accepted the deliverable format; the retest plan is recorded; critical and high findings were communicated through the agreed channel.
