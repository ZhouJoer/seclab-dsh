# Specialized protocols playbook (VoIP/ICS)

Use for authorized VoIP (SIP/IAX), ICS/OT (PLC, Modbus, S7, BACnet, DNP3), IPMI/BMC and other high-sensitivity protocol testing.

## Inputs

Exact IPs, ports, protocols, device types, maintenance windows and owner contacts; no-write rules, call/registration limits and maximum request rates; whether passive review, discovery, read-only validation or active testing is authorized; OT safety classification per device; physical access authorization for VLAN or switch-port tests.

## Workflow

1. **Safety, scope and protocol inventory.** Confirm every target in the scope record with its criticality classification — safety-critical, business-critical or standard — before any active probing; an unclassifiable device is treated as safety-critical. Prefer passive material first (diagrams, SPAN captures, asset inventories). Conservative-timing service detection with ICS and VoIP scripts (sip-methods, modbus-discover, s7-info, bacnet-info) identifies present protocols. No active phase starts until the scope record and classifications are confirmed, and safety-critical targets carry OT-owner approval for that specific interaction.
2. **VoIP discovery and enumeration.** SIP host discovery across the range, extension enumeration by dictionary or targeted ranges, registration behavior, and IAX username enumeration on Asterisk targets. Extension-rich hosts proceed to phase 3; passive trunks are documented and skip ahead.
3. **VoIP security testing.** With explicit approval: SIP credential testing starting from default and common passwords under the lockout policy; voice-VLAN hopping from the data VLAN via CDP/LLDP-MED/DHCP discovery where local switch-port access is authorized; RTP encryption assessment from captures (SRTP versus plain RTP); SIP TLS versus cleartext signaling. Every discovered host and extension is covered, each host-by-test result recorded as pass, fail or skipped. Stop immediately on any production call disruption or PBX instability.
4. **ICS/OT discovery.** Modbus (TCP/502), S7comm (TCP/102), BACnet/IP (UDP/47808) and DNP3 (TCP/20000) identification with firmware and device metadata, then per-device classification: safety-critical (physical process control), monitoring-only (historians, HMIs) or IT-adjacent (workstations, jump hosts). Safety-critical devices need OT-owner approval for any interaction including reads.
5. **ICS/OT read-only assessment.** Strictly read-only: holding and input register reads with the identified unit ID, recorded with values and data types; firmware versions cross-referenced against known CVEs and end-of-life status; historian and HMI authentication posture; IT-to-OT segmentation verification (reachability, path, firewall position). Never issue writes or state-changing commands; if a read perturbs a device, stop and notify the OT owner.
6. **IPMI/BMC and network infrastructure.** IPMI service discovery and default-credential checks; cipher-zero (unauthenticated access) and RAKP hash-disclosure findings; SNMP community-string testing from common lists then sensitive-OID walks (system, processes, installed software); printer and MFP web interfaces, PJL access and stored jobs checked without modifying configuration or printing.
7. **Layer 2 testing.** Only with explicit authorization and a controlled window: CDP/LLDP information gathering, DTP trunk negotiation, STP manipulation — disruptive techniques reserved for isolated environments.
8. **Evidence, risk assessment and escalation.** Compile the protocol inventory (host, port, protocol, device, firmware, criticality) and the segmentation assessment. Severity tiers: critical — unauthenticated access to safety-critical devices, IPMI cipher zero, unencrypted sensitive-call media, writable OT registers reachable from IT; high — default credentials on VoIP infrastructure, writable SNMP communities, missing IT/OT segmentation, known-CVE PLC firmware; medium — cleartext SIP, default read-only SNMP communities, VLAN hopping, weak IPMI passwords; low — banner and metadata disclosure. Safety-critical findings escalate to the OT owner and engagement lead immediately, not at report time. Record every authorized-but-not-performed test with its reason.

Tool selection: [../tools/voip-ics.md](../tools/voip-ics.md); SNMP and credential work in [../tools/vulnerability.md](../tools/vulnerability.md) and [../tools/password.md](../tools/password.md).

## Cross-references

internal-network (segmentation), password-audit (SNMP, SIP and IPMI credential cracking), reporting-workflow.

## Expected evidence

Protocol inventory with criticality classes; VoIP host and extension results with approval notes and RTP/TLS findings; OT device lists with firmware and CVE cross-references; read-only register snapshots; IPMI/SNMP findings; segmentation analysis; the excluded-tests list with justifications.

## Stop when

Approved discovery and read-only validation are complete for all in-scope protocols; further work requires OT writes, live call interception, firmware modification or state changes; any device instability, alarm or unexpected behavior appeared; credential attacks reached the approved limit.
