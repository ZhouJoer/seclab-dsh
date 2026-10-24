# Web application playbook

Use for authorized web applications, APIs, CMS targets and HTTP services discovered during reconnaissance. For source-driven reasoning load security-web; this playbook owns active testing through the selected environment.

## Inputs

Base URLs and allowed hosts; authentication details if any; test depth, rate limits and prohibited paths; whether active exploitation is allowed; API definitions (OpenAPI, GraphQL schema, Postman collections) when available.

## Workflow

1. **Baseline inventory.** Probe URLs for status, redirects, cookies, headers, TLS details and technologies (httpx-class bulk probing, whatweb fingerprinting, wafw00f WAF detection). Run a TLS cipher audit on every HTTPS endpoint (sslscan/testssl-class) for weak suites and known TLS attacks rather than spot checks. Follow expansion leads: wildcard certificate SANs to subdomain enumeration, permissive CORS origins to probe the named origin, certificate transparency for historical subdomains with distinct status codes marking distinct routed services.
2. **Crawling and endpoint discovery.** Crawl (katana/gospider-class), brute-force directories with registered wordlist tools (ffuf/gobuster/feroxbuster), and discover hidden parameters (arjun-class). Download the application's JavaScript and search it for endpoints, internal URLs, subdomains and hardcoded secrets — leads unreachable by crawling. Run a full TCP port scan against the application IP; admin panels and debug interfaces live off-port. Compile a deduplicated endpoint-and-parameter inventory; a non-trivial application yielding under ten unique endpoints means retry with more wordlists, depth and extensions. Management interfaces (phpMyAdmin, Adminer, pgAdmin, Kibana, Grafana, Redis consoles) discovered in enumeration are immediately tested with the working credential list. Treat any endpoint answering non-401 as its own attack surface regardless of an empty-looking body.
3. **Automated DAST.** nuclei (template-selected, severity-gated, JSONL) and nikto early for known CVEs and misconfigurations; full-suite scans only with explicit authorization. A zero-finding scanner result is not accepted at face value: re-run with expanded scope and confirm in verbose output that templates loaded and requests were sent.
4. **Targeted vulnerability testing.** Every inventory endpoint is tested against every applicable class, not only ones that look injectable: SQL injection (sqlmap with saved representative requests, escalating level/risk before accepting a negative), command injection (commix-class), SSTI when a template engine is detected (sstimap-class), XSS (dalfox-class for bulk, context-aware tools for depth), SSRF through URL and file parameters including cloud metadata addresses, XXE on XML inputs, file-upload restrictions and polyglots, deserialization gadget chains for the observed stack, HTTP request smuggling where front and back ends differ, and CRLF injection. Check security headers, CORS with crafted origins and null origins, and CSP source liveness (NXDOMAIN in a CSP allowlist is a bypass risk). Compare TLS, headers, CORS and authentication across co-hosted services — the weakest one is usually the finding. CMS targets: identify first (cmseek-class), then the matching scanner (wpscan for WordPress, joomscan for Joomla); plugin-ecosystem vulnerabilities need the CMS-specific scanner, which generic scanners miss.
5. **Authenticated testing.** Preserve session handling and rate limits; route replay and evidence capture through a proxy (mitmproxy-class) when needed. After obtaining a session: broken authentication (fixation, token entropy, missing re-auth), JWT flaws (alg:none, weak secrets, kid injection — jwt_tool-class), IDOR/BOLA across roles and objects, CORS reflection, CSRF token binding, privilege escalation from low-privilege accounts, forced browsing without cookies. Credentials discovered in any phase are tested against all authentication endpoints immediately.
6. **WebSocket testing.** Where WebSocket endpoints appear: handshake authentication, per-message authorization against other users' resources, injection in messages, and sensitive data in frames.
7. **Business logic.** Race conditions on critical operations with concurrent requests, workflow step bypasses with server-side enforcement checks, price/quantity/discount manipulation, coupon reuse and stacking.
8. **Secrets and source artifacts.** Secret scanning (gitleaks-class) only when source or artifacts are in scope; with source available, hand off to the source-code-audit playbook.

Tool selection: [../tools/web.md](../tools/web.md) for application testing, [../tools/vulnerability.md](../tools/vulnerability.md) for scanners, [../tools/exploitation.md](../tools/exploitation.md) when a confirmed vulnerability warrants shell access.

## Cross-references

external-attack-surface (new infrastructure), api-security, internal-network, password-audit, source-code-audit, reporting-workflow.

## Expected evidence

URL and endpoint inventory; parameter list with representative requests; scanner reports in machine-readable form; confirmed findings with reproduction requests; per-endpoint positive and negative results.

## Stop when

Every inventory endpoint is tested against applicable classes with recorded results; cross-resource authorization used other users' IDs; scanner zero-findings were rechecked; distinct input contexts (reflection, storage, redirect, mail) were tested separately; further progress needs high-risk exploitation approval or is blocked by authentication, rate limits or WAF controls.
