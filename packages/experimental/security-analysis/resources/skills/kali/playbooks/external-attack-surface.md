# External attack surface playbook

Use for authorized domains, organization names, ASN/IP ranges and cloud scope reachable from the selected Kali environment.

## Inputs

Authorized root domains, company names, ASN/IP ranges and cloud namespaces; whether the phase is OSINT-only before any active probing; any operator-provided API keys for passive sources.

## Workflow

1. **Passive discovery.** Combine at least three independent passive sources (subfinder-class, amass passive, certificate transparency via crt.sh or a certgraph-class tool) — a single source is never sufficient for subdomain enumeration. Add theHarvester-class collection, Shodan queries for the organization, WHOIS registration data, SPF/DKIM/DMARC records for spoofing exposure, archived historical URLs (gau-class), and public code repositories. Keep passive and active findings in separate saved lists. Repository exposure, leaked configuration or tokens found here are immediately tested against discovered authentication endpoints and recorded.
2. **DNS validation and expansion.** Merge and deduplicate candidates, resolve in bulk with a dnsx-class tool, and expand naming patterns with permutation generators (dnsgen/altdns-class) validated by mass resolution. Zone transfers only against authorized domains.
3. **HTTP and port exposure.** Probe live HTTP with an httpx-class tool (title, status, technology, TLS metadata); port coverage must include at least one full TCP range pass over in-scope IPs, with disagreements between fast and precise scanners re-confirmed by version detection. Record WAF/CDN identification (wafw00f-class); with a CDN, origin discovery via historical DNS, certificate subjects and direct IP checks. Apply the internal-network playbook's two-phase confirmation, unknown-service probing and per-service matrix to everything discovered.
4. **Subdomain takeover assessment.** Extract CNAME records, check dangling targets against claimable cloud services (S3, Azure, Heroku, GitHub Pages, Fastly, Shopify) by probing for unclaimed-service responses; confirm candidates manually. A confirmed claimable target is a high finding.
5. **Cloud exposure.** Enumerate cloud namespaces in scope only (cloud-enum/cloudbrute-class); public buckets, exposed admin panels and leaked endpoints are findings requiring validation, not raw report lines.
6. **Vulnerability triage.** Low-impact nuclei templates first (critical/high severity, JSONL output), TLS configuration checks, then hand confirmed applications to web-application or api-security. Triage: confirmed RCE, authentication bypass or data exposure are immediately reportable; informational findings are documented and deprioritized.
7. **Evidence and deduplication.** Normalize hosts by domain, IP, port, scheme and redirect target; deduplicate findings across aliases before reporting, keeping the canonical form with its sources.

Tool selection: [../tools/information-gathering.md](../tools/information-gathering.md) for discovery and fingerprinting, [../tools/vulnerability.md](../tools/vulnerability.md) for scanning.

## Cross-references

web-application, api-security, internal-network (VPN or pivot opportunities), cloud-native-assessment, reporting-workflow.

## Expected evidence

Scope and source list; validated subdomains and DNS records; HTTP inventory with status, title and technology; IP/port inventory; confirmed exposure findings with false-positive notes.

## Stop when

Discovered subdomains and IPs are resolved, port-scanned and fingerprinted with no new assets on re-enumeration; every exposed service is triaged or documented as informational; remaining work needs authentication, exploitation or broader scope.
