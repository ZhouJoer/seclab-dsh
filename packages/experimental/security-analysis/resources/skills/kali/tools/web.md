# Web testing selection

Injection and client-side testing follow the web-application and api-security playbooks. Every automated result needs manual validation; route authenticated and replayed traffic through a proxy and preserve request/response pairs as evidence.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| Directory brute-force | feroxbuster-class (recursive) or ffuf (fine-grained) | gobuster-class for quick small-site scans |
| Parameter discovery | arjun-class | Before injection testing |
| SQL injection | sqlmap with saved requests; escalate level/risk before accepting a negative | --tamper under WAF; skip time-based when timestamps churn |
| XSS | dalfox-class bulk; context-aware tools for depth | Cover reflected, stored and DOM contexts separately |
| Command injection | commix-class | |
| SSTI | sstimap-class | When a template engine is fingerprinted |
| JWT testing | jwt_tool-class playbook scan then all tests | Record non-JWT formats as not applicable |
| CRLF injection | crlfuzz-class | |
| CMS-specific | cmseek-class identify → wpscan (WordPress) / joomscan (Joomla) | Plugin-ecosystem CVEs need the CMS-specific scanner |
| Crawling | katana-class (headless-capable) or gospider-class | Historical URLs via archives |
| Full DAST | zaproxy-class baseline/API scans | Full scans need explicit authorization |
| Black-box scanning | wapiti-class | Complements nuclei and nikto |
| Traffic proxy | mitmproxy-class for capture, replay and addon scripting | Signing proxies: disable HTTP/2 when mixed-case custom headers matter |
| API route discovery | kiterunner-class API-aware wordlists | Over ffuf for API path patterns |
| Schema-driven API testing | schemathesis-class | Explicit approval; high request volume |
| GraphQL | graphw00f-class fingerprint; clairvoyance-class schema recovery | Recovery only when approved |
| gRPC / WebSocket | grpcurl-class; websocat-class | Reflection or proto files required for grpcurl |
| Deserialization | phpggc-class gadget generation; padbuster-class padding oracle | Confirmed sink required first |
| Subdomain takeover | subjack-class after CNAME extraction | Manual confirmation of claimable targets |

Decision points: sqlmap clean on defaults — escalate before accepting; multiple injection candidates on one parameter — SQL, command, SSTI in order; API signing blocks tools — proxy addon or engine-side evaluation with static headers (see api-security phase 5).
