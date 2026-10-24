# Information gathering selection

Passive collection contacts no target; active scanning stays inside the authorized rate. Prefer structured output (JSON/JSONL) and save inventories as fresh outputs files for later phases.

| Scenario | Tool chain | Notes |
| --- | --- | --- |
| Passive subdomain discovery | subfinder-class → dnsx-class → httpx-class | amass-class for deep recursive and historical enumeration |
| Subdomain completeness | ≥3 independent passive sources (subfinder, amass passive, certificate transparency) | A single source is never sufficient |
| DNS permutation discovery | dnsgen/altdns-class generation → massdns/dnsx-class validation → httpx liveness | For naming-pattern subdomains after passive exhaustion |
| Port scanning at scale | fast scanner (masscan/naabu-class) to locate → nmap -sV to confirm | Two-phase confirmation is mandatory; fast scans drop ports |
| Precise port scanning | nmap -sS -sV -sC with XML output | |
| Internal host discovery | arp-scan/netdiscover-class on LAN; nmap -sn cross-subnet; IPv6 via -6 -sn and multicast | |
| Full DNS enumeration | dnsenum/dnsrecon-class | dig-class for single-record questions |
| Web fingerprinting | whatweb + wafw00f-class | httpx-class for bulk liveness with titles and technology |
| OSINT collection | whois → theHarvester-class | spiderfoot/recon-ng-class for framework-scale collection |
| Historical URLs | gau-class archives | katana/gospider-class when active crawling is authorized |
| Cloud asset enumeration | cloud-enum/cloudbrute-class | Authorized namespaces only |
| Secret scanning of public material | trufflehog-class | gitleaks-class for git scopes |
| Document metadata | metagoofil-class | |
| Identity OSINT | sherlock-class; h8mail-class for breach lookups | |

Decision points: passive-only constraint — subfinder + amass passive + Shodan + theHarvester, no active scanners; origin behind CDN — DNS records, certificate-transparency graphs and historical IPs; known-large organization with thin results — add certificate-transparency graphs, multi-source harvesting and typosquatting permutations.
