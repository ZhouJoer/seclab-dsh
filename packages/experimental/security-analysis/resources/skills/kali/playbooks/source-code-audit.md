# Source code and dependency audit playbook

Use for authorized source repositories, build artifacts, CI/CD pipelines and dependency manifests where SAST, secret scanning and software composition analysis are in scope. Read-only history inspection of imported checkouts follows the mining provider's git guide; this playbook owns the audit workflow.

## Inputs

Repository paths, archives or imported checkouts in scope; language stack, build system and package manifests; whether Git history is in scope; output formats and data-handling rules for credential findings.

## Workflow

1. **Scope and access validation.** Confirm what is in scope (working tree, full history, CI artifacts, lock files, built images) and record repository identity, commit or tag, and languages before scanning.
2. **Secret and credential scanning.** Directory scans for unpacked trees, history scans where history is in scope, with redaction before any report leaves the engagement. A zero-finding scanner result gets a manual pattern spot-check (provider key prefixes, key block headers, assignment patterns) before acceptance, documented in the case notes.
3. **SAST.** Language-appropriate engines plus a multi-language ruleset engine; detect the stack from build files first and choose the chain accordingly. Never report raw SAST output: for each high or critical finding, trace the data flow from entry point to sink, check sanitization and framework protection along the path, and classify confirmed, likely, false positive or needs-live-testing. Manual review complements engines: dangerous function patterns (command execution, deserialization, client-side injection sinks, raw query construction), authentication and authorization logic on every route including admin and internal endpoints, and error handling that leaks internals.
4. **Software composition analysis.** Manifest and lock-file scanning for known CVEs with an SBOM-based alternative when suitable; ecosystem-native auditors where they add signal. Assess reachability for high/critical CVEs — the vulnerable module imported and invoked outranks a dormant dependency-tree match. Prioritize confirmed-valid secrets over exploitable paths over reachable CVEs over informational misconfigurations.
5. **IaC and configuration review.** Dockerfiles, Kubernetes manifests, Terraform, Helm charts and pipeline definitions: hardcoded secrets in plaintext variables, over-permissive pipeline identities, pull_request_target misuse with untrusted checkout, unpinned third-party actions, insecure artifact handling, and signing posture.
6. **Triage and deduplication.** Correlate and deduplicate across tools; record tool, rule or CVE identifier, file path, line and reproduction context for every confirmed finding.

Tool selection: [../tools/vulnerability.md](../tools/vulnerability.md) for SCA and configuration scanning; secret scanning through registered tooling per catalog guides.

## Cross-references

web-application and api-security (live endpoint testing of discovered findings), reporting-workflow.

## Expected evidence

Secret scan report (redacted) with source tree versus history attribution; validated SAST findings with data-flow reasoning per classification; dependency CVE report with reachability assessments; SBOM where generated; IaC and pipeline findings.

## Stop when

All in-scope repositories, manifests and artifact paths are scanned; SAST findings carry data-flow validation; zero-secret results carry manual verification; high/critical CVEs carry reachability assessments; remaining work requires live endpoints (hand off) or production secrets (out of scope).
