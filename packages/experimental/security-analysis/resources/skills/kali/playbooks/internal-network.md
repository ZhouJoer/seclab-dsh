# Internal network playbook

Use for authorized internal ranges, lab networks and CTF-style engagements starting from an IP, CIDR or known host, through a selected Kali environment. This is the default playbook when the target matches no specialized row.

## Inputs

Authorized IPs/CIDRs and excluded hosts; scan windows, rate limits and intrusive-test limits; selected environment and its reachability to the target range.

## Workflow

1. **Connectivity and routing.** Confirm the selected environment reaches the target range (ip route, ping, arp or a protocol-specific probe) and record the source position. An unreachable host is an environment fact, not a target conclusion; report it and continue other scope.
2. **Host discovery.** Low-noise first: nmap -sn ping sweep or arp-scan on the local segment; masscan-class tools only at authorized rate. Include IPv6 (nmap -6 -sn on a known prefix; link-local multicast then neighbor table). Save a live-host list as a fresh outputs/ file for later phases. With no live hosts, verify connectivity, broaden discovery methods (ARP, SYN to common ports, IPv6 multicast) and consider host firewalls dropping ICMP before concluding emptiness.
3. **Port and service mapping.** Top-port TCP with version detection on live hosts, then full TCP on key hosts, then UDP by depth (top 20 covers SNMP/DNS/NTP/TFTP/IPMI/NetBIOS; always cover UDP/161 and UDP/623 on infrastructure devices). Prefer nmap XML output (-oX/-oA) and read it as the saved artifact.

   Two-phase confirmation is mandatory: a fast full-port pass (--min-rate 2000) silently drops ports in congested or containerized networks, so re-scan the discovered port set at low speed with retries, version detection and safe scripts before trusting the inventory. A confirmed-live host with zero open ports gets a full connect retry (-sT -Pn -p-), then is documented as filtered.

   Probe every service a scanner labels unknown, tcpwrapped or `?`: TLS certificate metadata, ALPN negotiation for known protocols, then banner capture; only then mark it unidentified. Ambiguous or error-containing script results are verified with manual protocol interaction or a second tool before a service test counts as complete.

   Complete the per-service matrix before moving on: precise version, CVE applicability with version ranges, anonymous or unauthenticated access, protocol-level probes (RPC endpoints, named pipes, handshakes), credential checks within lockout policy using known plus fasttrack-derived candidates, configuration security, and whether the weakness combines with another finding. Dynamic RPC endpoints and secondary listeners of an already-tested service need identity and version only. Record explicit negative results; a service that looks secure has only been identified, not tested. Services that reject by source IP are locally bound — defer them to a list and retest from the host after initial access. Treat AD domain signals (names, RID-cycling users) as handoff material but finish the current matrix first.
4. **Network infrastructure and segmentation.** Enumerate routers, switches and firewalls through SNMP and management interfaces; test VLAN reachability beyond the authorized segment; check management-interface default credentials; attempt zone transfers and reverse-DNS sweeps only for authorized domains.
5. **Protocol enumeration and routing.** Route each discovered service: custom web app or CMS → web-application playbook; known product web UI (Jenkins, Grafana, phpMyAdmin) → version, known CVEs, credential and misconfiguration checks only, not the full web workflow; static or default page → directory enumeration and fingerprinting only; API-heavy HTTP (JSON content types, /api-docs, /swagger, /openapi.json, /graphql) → api-security playbook; Kubernetes, Docker API, registry, cloud metadata → cloud-native-assessment; SIP/IAX/ICS/OT → voip-ics; other interior protocols → internal-network-protocols. Finish a handed-off playbook, then return to the next service here. When credentials surface in any phase, test them against all discovered authentication services immediately.
6. **Vulnerability assessment.** nuclei network templates against non-HTTP services (severity-gated, JSONL output), TLS configuration checks on key hosts, protocol-specific NSE checks; full-suite scanners only for Deep with the operator's initialization. Record LLMNR/NBT-NS/mDNS exposure as a finding with the note that responder-class capture (analyze mode first) needs its own approval; captured hashes go to the password-audit playbook.
7. **Credential checks.** Default and known credentials only within the authorized lockout policy; prefer a multi-protocol sweep tool (netexec-class) across discovered services; hash cracking and spraying belong to the password-audit playbook.
8. **Exploitation and post-exploitation.** Exploit only confirmed vulnerabilities after explicit approval, choosing paths by reliability (proven exploit over PoC), stealth (credentials over code execution) and reversibility. On initial access, switch to the post-exploitation playbook, restart reconnaissance on newly reachable in-scope networks, then return to test deferred locally-bound services from the compromised host.

Tool selection: [../tools/information-gathering.md](../tools/information-gathering.md) for discovery, [../tools/vulnerability.md](../tools/vulnerability.md) for scanning, [../tools/password.md](../tools/password.md) for credentials; per-tool flags follow each catalog guide.

## Cross-references

internal-network-protocols (non-HTTP protocols), active-directory, web-application, api-security, cloud-native-assessment, voip-ics, password-audit, post-exploitation, wireless-assessment, reporting-workflow.

## Expected evidence

Live-host list; saved nmap XML with execution status and coverage; service inventory per host; infrastructure and segmentation notes; vulnerability scan output with severity; credential results with lockout-safe notes; captured-hash artifacts where applicable — each captured through security_capture_analysis.

## Stop when

Every in-scope live host has a service inventory and completed per-service matrix; standard vulnerability and protocol checks are done; segmentation is documented; further progress requires intrusive exploitation or out-of-scope pivots.
