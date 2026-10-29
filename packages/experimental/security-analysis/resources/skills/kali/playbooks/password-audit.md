# Password audit playbook

Use for authorized password cracking, hash analysis, default-credential checks, password spraying and credential-reuse testing.

## Inputs

Hash files, credential lists, usernames, target services and scope; lockout policy, allowed rate and time window, account exclusions; whether GPU cracking is available and authorized.

## Workflow

1. **Password policy analysis.** Before any attack, establish minimum length, complexity, maximum length and character restrictions; lockout threshold, duration and reset behavior; rotation and history depth. Policy facts focus wordlist, rule and mask selection and skip candidates that cannot exist.
2. **Classify material.** Identify hash types with hashid-class tools or source context, separating hashes, plaintext credentials, usernames and service targets. Source context disambiguates multiple candidates (/etc/shadow → sha512crypt; NTDS.dit → NT; responder captures → NetNTLMv2), then length and charset, then a small test wordlist before committing. Encrypted-file material is converted to crackable hashes by the matching *2john extractor before cracking.
3. **Prepare wordlists and rules.** Standard lists, SecLists-class collections, target-derived wordlists (cewl-class) and rule sets; large generated lists only for Deep.
4. **Offline recovery.** Select the method from verified input parameters, available clues, hardware and budget using [the password selection guide](../tools/password.md). Strategies can be skipped or revisited as evidence changes. Separate unsupported input, invalid configuration, exhausted candidates and interrupted execution. Save the selected resources, parameters and verified outcomes; retain incomplete results as incomplete.
5. **Online testing.** Known and default credentials first, brute force last, always inside the lockout policy: per-account attempt limits, lockout-safe delays, stop conditions. Prefer a multi-protocol sweep tool for breadth (SMB, WinRM, SSH, MSSQL, LDAP, HTTP) and protocol-specific engines for depth; Kerberos spraying sprays one password across many users (lockout-safer) with the domain policy checked beforehand. Cover every discovered authentication service — an untested service is an untested attack surface.
6. **Credential reuse.** Test every cracked or provided credential against every authorized service, recording success, failure, MFA block, disabled account or permission level per cell of the credential-by-service matrix. Untested cells are coverage gaps.
7. **MFA assessment.** Only with explicit approval: push fatigue, short-OTP rate limiting, backup-code reuse, and enrollment bypass with valid credentials; document enforcement gaps as findings.
8. **Hash capture.** responder-class capture, relay tooling and poisoning only with explicit approval and internal scope. Always observe first in analyze mode before any active poisoning; captured hashes enter phase 4. Relay execution itself belongs to the active-directory playbook's approval chain.

Tool selection: [../tools/password.md](../tools/password.md).

## Cross-references

active-directory (AS-REP roasting and Kerberoasting workflows), post-exploitation (hash extraction methods), reporting-workflow.

## Expected evidence

Hash-type inventory; wordlists and rules used; cracking command logs and cracked-credential list; online attempt counts with lockout-safe evidence; the credential-by-service reuse matrix.

## Stop when

Offline cracking reaches the agreed time budget; online testing reaches the attempt limit; any account-lockout risk, unexpected production impact or out-of-scope credential appears.
