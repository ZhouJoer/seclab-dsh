# Forensics triage playbook

Use for authorized analysis of disk images, memory dumps, packet captures, logs and suspected hidden data. Default to read-only handling of immutable copies; destructive writes are prohibited without separate authorization. Offline capture analysis with bundled scripts belongs to security-packet-analysis (iot module); this playbook owns multi-source forensic triage through the selected environment.

## Inputs

Evidence files with hashes where provided, case objective and allowed output location; whether destructive writes are prohibited (default yes); target OS or acquisition source; available evidence types (memory dump, disk image, PCAP, Windows event logs, individual files).

## Workflow

1. **Evidence handling.** Work on verified copies only, with chain-of-custody notes (source, time, tool, hash) recorded from acquisition; damaged media uses error-mapping imaging. Record hashes of every working copy in the case notes.
2. **Identify file types.** Identity checks, metadata extraction (exiftool-class), embedded-content scanning and archive handling; identify partitions and filesystems in disk images before extraction.
3. **Memory analysis.** Volatility-class analysis with the correct symbols: process and network state, credential material, malware indicators and timelines according to the case objective.
4. **Timeline construction.** Correlate filesystem MAC times, event logs and memory artifacts into one normalized timeline (plaso-class), focused on the incident window: file creation and modification, process execution, network connections and log entries. Every suspicious artifact gets corroborating evidence from at least one other source (memory, disk, traffic, logs); uncorroborated items are flagged, not dropped. Timestamp inconsistencies feed phase 9.
5. **Disk and file recovery.** Carving with signature-based tools, bulk extraction, and filesystem-aware recovery; preserve recovered paths and hashes, verify integrity (hashdeep-class) and identify similar files by fuzzy hashing (ssdeep-class). Malware triage of extracted material with YARA rules against community or engagement-specific rule sets, cross-referenced with hash databases.
6. **Traffic analysis.** Conversation summaries, protocol-specific extraction (DNS, HTTP, TLS metadata) and stream reassembly from captures; for bundled offline script analysis load security-packet-analysis after enabling the iot module.
7. **Registry and application artifacts.** Windows hive analysis for persistence, user activity and device history (SAM, SYSTEM, SOFTWARE, NTUSER.DAT, USB history); browser artifacts (history, downloads, cached pages, saved credentials); Windows event-log hunting with Sigma rules (logon, process-creation, service-installation events; log-clearing events feed phase 9). Linux sources: auth logs, syslog, shell histories, cron, SSH known hosts and authorized keys, the journal, dropped tools in tmp.
8. **Logs and metadata.** Targeted event-log searches by the case questions; metadata extraction across recovered documents; steganography passphrase recovery where relevant.
9. **Anti-forensics detection.** Timestomping (SI versus FN timestamp divergence, creation after modification), log clearing (sequence gaps, event 1102), wiping-tool artifacts, zeroed clusters, journal anomalies; encrypted containers are identified and routed to the password-audit playbook for decryption approaches. Rootkit scanning of mounted evidence where applicable. Correlate indicators with the timeline to place destruction after the incident.

Tool selection: [../tools/forensics.md](../tools/forensics.md).

## Cross-references

password-audit (encrypted evidence), post-exploitation (credential material feeding authorized workflows), security-packet-analysis (offline capture scripts, iot module), reporting-workflow.

## Expected evidence

Evidence inventory with custody notes and hashes; the unified timeline with cross-source correlations; extracted indicators, files and protocol summaries; registry and application findings; anti-forensics indicators; every finding tied to its source evidence.

## Stop when

The case objective is answered with evidence-backed conclusions; all available evidence types are analyzed and cross-referenced in the timeline; anti-forensics detection is complete with gaps documented; further analysis would require destructive modification, cracking beyond budget or out-of-scope data review.
